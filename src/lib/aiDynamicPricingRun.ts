import type { SupabaseClient } from "@supabase/supabase-js";
import { getCloudbedsBaseRateId, pushCloudbedsRate, CloudbedsApiError } from "@/lib/cloudbedsApi";
import { resolveCloudbedsRoomTypeGroups } from "@/lib/cloudbedsRoomTypeMapping";
import { refreshCompetitorDataIfStale, decideRatesForRoomType, type PricingSettings, type RoomTypeForPricing } from "@/lib/aiPricingEngine";

/**
 * Owner-approved (2026-09-11) AI dynamic pricing: decide a price per room
 * type (occupancy + AI competitor research + high season, clamped to the
 * min_rate/max_rate guardrail) and push it to Cloudbeds via putRate, so
 * it reaches every OTA through Cloudbeds' own channel manager. See
 * src/lib/aiPricingEngine.ts and src/lib/cloudbedsApi.ts for the pieces;
 * this module is just the orchestration shared by the cron
 * (src/app/api/cron/ai-dynamic-pricing) and the admin manual trigger
 * (src/app/api/admin/cloudbeds/run-ai-pricing).
 *
 * Requires CLOUDBEDS_API_KEY to carry write:rate scope -- as of
 * 2026-09-11 it does not (read-only key). Until the owner upgrades the
 * key on Cloudbeds' own dashboard, every room type will report a
 * CloudbedsApiError here (permission denied), which is surfaced per
 * room type in the result rather than thrown, so the rest of the run
 * (decision computation, villa_rates bookkeeping) still completes.
 */

const JAKARTA_TZ = "Asia/Jakarta";
const WINDOW_DAYS = 14;

function fmtDateJakarta(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function todayJakarta(): string {
  return fmtDateJakarta(new Date());
}

export interface AiPricingRoomTypeResult {
  villa_room_type_code: string;
  cloudbeds_room_type_id: string | null;
  competitor_data_refreshed: boolean;
  today_decided_rate: number | null;
  today_guardrail_status: string | null;
  dates_decided: number;
  pushed_to_cloudbeds: boolean;
  job_reference_id: string | null;
  tarif_harian_updated_units: number;
  error?: string;
}

export interface AiPricingRunSummary {
  ok: true;
  today: string;
  window_days: number;
  results: AiPricingRoomTypeResult[];
}

export async function runAiDynamicPricing(supabase: SupabaseClient): Promise<AiPricingRunSummary> {
  const today = todayJakarta();
  const toDate = addDays(today, WINDOW_DAYS - 1);
  const targetDates: string[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) targetDates.push(addDays(today, i));

  const { data: settingsRows } = await supabase.from("villa_pricing_settings").select("*").eq("active", true).limit(1);
  const settings = settingsRows?.[0] as
    | {
        max_daily_movement_pct: number;
        high_occupancy_threshold_pct: number;
        high_occupancy_adjustment_pct: number;
        low_occupancy_threshold_pct: number;
        low_occupancy_adjustment_pct: number;
      }
    | undefined;
  if (!settings) {
    return { ok: true, today, window_days: WINDOW_DAYS, results: [] };
  }
  const pricingSettings: PricingSettings = {
    max_daily_movement_pct: Number(settings.max_daily_movement_pct),
    high_occupancy_threshold_pct: Number(settings.high_occupancy_threshold_pct),
    high_occupancy_adjustment_pct: Number(settings.high_occupancy_adjustment_pct),
    low_occupancy_threshold_pct: Number(settings.low_occupancy_threshold_pct),
    low_occupancy_adjustment_pct: Number(settings.low_occupancy_adjustment_pct),
  };

  const { data: roomTypes } = await supabase
    .from("villa_room_types")
    .select("id, code, name, description, min_rate, max_rate")
    .eq("active", true);
  const { data: units } = await supabase.from("units").select("id, room_type_id, tarif_harian");
  const { villaRoomTypeIdByCloudbedsRoomType } = await resolveCloudbedsRoomTypeGroups(supabase);
  const cbRoomTypeIdByVillaRoomType = new Map<string, string>();
  for (const [cb, villa] of villaRoomTypeIdByCloudbedsRoomType) cbRoomTypeIdByVillaRoomType.set(villa, cb);

  const results: AiPricingRoomTypeResult[] = [];

  for (const rt of (roomTypes ?? []) as RoomTypeForPricing[]) {
    const unitsOfType = (units ?? []).filter((u: { room_type_id: string | null }) => u.room_type_id === rt.id);
    if (unitsOfType.length === 0) continue;
    const currentRate = Number(unitsOfType[0].tarif_harian ?? 0);
    if (currentRate <= 0) continue;

    const cbRoomTypeId = cbRoomTypeIdByVillaRoomType.get(rt.id) ?? null;

    let competitorRefreshed = false;
    try {
      competitorRefreshed = await refreshCompetitorDataIfStale(supabase, rt);
    } catch {
      // AI research bridge failure never blocks the deterministic part of the run.
    }

    const decisions = await decideRatesForRoomType(supabase, rt, currentRate, targetDates, pricingSettings);
    const todayDecision = decisions.find((d) => d.date === today) ?? null;

    for (const d of decisions) {
      const { data: existingRate } = await supabase
        .from("villa_rates")
        .select("id")
        .eq("room_type_id", rt.id)
        .eq("date", d.date)
        .is("rate_plan_id", null)
        .maybeSingle();
      const row = {
        room_type_id: rt.id,
        rate_plan_id: null,
        date: d.date,
        rate: d.decided_rate,
        source: "ai_recommendation",
        reason: d.reason_codes.join(",") || "no_adjustment",
        updated_by: "ai_dynamic_pricing_cron",
      };
      if (existingRate) {
        await supabase.from("villa_rates").update(row).eq("id", existingRate.id);
      } else {
        await supabase.from("villa_rates").insert(row);
      }
    }

    let pushed = false;
    let jobReferenceId: string | null = null;
    let error: string | undefined;
    if (!cbRoomTypeId) {
      error = "No Cloudbeds room type mapped for this villa room type";
    } else {
      try {
        const rateId = await getCloudbedsBaseRateId(cbRoomTypeId, today);
        if (!rateId) {
          error = "Cloudbeds rate for this room type is derived/unavailable -- cannot push";
        } else {
          const pushResult = await pushCloudbedsRate(
            rateId,
            decisions.map((d) => ({ startDate: d.date, endDate: d.date, rate: d.decided_rate })),
          );
          pushed = true;
          jobReferenceId = pushResult.jobReferenceId;
        }
      } catch (e) {
        error = e instanceof CloudbedsApiError ? e.message : e instanceof Error ? e.message : String(e);
      }
    }

    let updatedUnits = 0;
    if (todayDecision) {
      const { data: updated } = await supabase
        .from("units")
        .update({ tarif_harian: todayDecision.decided_rate })
        .eq("room_type_id", rt.id)
        .neq("tarif_harian", todayDecision.decided_rate)
        .select("id");
      updatedUnits = updated?.length ?? 0;
    }

    results.push({
      villa_room_type_code: rt.code,
      cloudbeds_room_type_id: cbRoomTypeId,
      competitor_data_refreshed: competitorRefreshed,
      today_decided_rate: todayDecision?.decided_rate ?? null,
      today_guardrail_status: todayDecision?.guardrail_status ?? null,
      dates_decided: decisions.length,
      pushed_to_cloudbeds: pushed,
      job_reference_id: jobReferenceId,
      tarif_harian_updated_units: updatedUnits,
      error,
    });
  }

  return { ok: true, today, window_days: WINDOW_DAYS, results };
}
