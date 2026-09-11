import type { SupabaseClient } from "@supabase/supabase-js";
import { getCloudbedsBaseRateId, pushCloudbedsRate, getCloudbedsRoomTypeRate, CloudbedsApiError } from "@/lib/cloudbedsApi";
import { resolveCloudbedsRoomTypeGroups } from "@/lib/cloudbedsRoomTypeMapping";
import { syncCloudbedsRates, type RateSyncSummary } from "@/lib/cloudbedsRateSync";
import {
  refreshCompetitorDataIfStale,
  decideRatesForRoomType,
  type PricingSettings,
  type RoomTypeForPricing,
  type CompetitorRefreshResult,
} from "@/lib/aiPricingEngine";

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
 * NOTE (2026-09-11): CLOUDBEDS_API_KEY already carries write:rate --
 * confirmed by testing putRate directly (a validation error surfaced,
 * not a permission error). putRate's endDate is EXCLUSIVE (like a
 * checkout date), so a single-day interval is [date, date+1); the
 * post-push read-back below verifies that empirically every run rather
 * than trusting the assumption with real money.
 *
 * Safety rules this module must keep (all three were violated by the
 * first version and cost real price drift on 2026-09-11):
 *  1. Compute from villa_room_types.base_rate, a value this engine
 *     never writes -- never from tarif_harian, which it does write.
 *     Otherwise each run compounds on the last and Fri/Sat runs ratchet
 *     the price up to max_rate no matter how empty the villa is.
 *  2. Change nothing locally unless Cloudbeds accepted the same price.
 *  3. Push only when asked: the nightly cron obeys
 *     villa_pricing_settings.ai_autopush_enabled (default false), so
 *     the live price keeps following Cloudbeds until the owner opts in.
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
  anchor_rate: number;
  competitor_refresh: CompetitorRefreshResult;
  today_decided_rate: number | null;
  today_guardrail_status: string | null;
  dates_decided: number;
  pushed_to_cloudbeds: boolean;
  job_reference_id: string | null;
  verification: { checked: boolean; matched_dates: number; mismatched: Array<{ date: string; expected: number; actual: number | null }> } | null;
  error?: string;
}

export interface AiPricingRunSummary {
  ok: true;
  today: string;
  window_days: number;
  autopush_enabled: boolean;
  push_requested: boolean;
  results: AiPricingRoomTypeResult[];
  reconciled: RateSyncSummary | null;
}

/**
 * `pushOverride` lets the admin manual trigger push for a deliberate
 * test while the nightly cron stays governed by
 * villa_pricing_settings.ai_autopush_enabled (default false).
 */
export async function runAiDynamicPricing(supabase: SupabaseClient, pushOverride?: boolean): Promise<AiPricingRunSummary> {
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
        ai_autopush_enabled: boolean;
      }
    | undefined;
  const autopushEnabled = !!settings?.ai_autopush_enabled;
  const pushRequested = pushOverride ?? autopushEnabled;
  if (!settings) {
    return { ok: true, today, window_days: WINDOW_DAYS, autopush_enabled: false, push_requested: false, results: [], reconciled: null };
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
    .select("id, code, name, description, base_rate, min_rate, max_rate")
    .eq("active", true);
  const { data: units } = await supabase.from("units").select("id, room_type_id, tarif_harian");
  const { villaRoomTypeIdByCloudbedsRoomType } = await resolveCloudbedsRoomTypeGroups(supabase);
  const cbRoomTypeIdByVillaRoomType = new Map<string, string>();
  for (const [cb, villa] of villaRoomTypeIdByCloudbedsRoomType) cbRoomTypeIdByVillaRoomType.set(villa, cb);

  const results: AiPricingRoomTypeResult[] = [];
  let researchBudget = 1;

  for (const rt of (roomTypes ?? []) as RoomTypeForPricing[]) {
    const unitsOfType = (units ?? []).filter((u: { room_type_id: string | null }) => u.room_type_id === rt.id);
    if (unitsOfType.length === 0) continue;

    // Anchor on the room type's fixed base_rate, never on tarif_harian:
    // tarif_harian is written BY this engine (and by the Cloudbeds pull),
    // so using it as the input made every run compound on the last one.
    const anchorRate = rt.base_rate !== null ? Number(rt.base_rate) : 0;
    if (anchorRate <= 0) {
      results.push({
        villa_room_type_code: rt.code,
        cloudbeds_room_type_id: cbRoomTypeIdByVillaRoomType.get(rt.id) ?? null,
        anchor_rate: 0,
        competitor_refresh: { refreshed: false, skipped_reason: "no base_rate set" },
        today_decided_rate: null,
        today_guardrail_status: null,
        dates_decided: 0,
        pushed_to_cloudbeds: false,
        job_reference_id: null,
        verification: null,
        error: "villa_room_types.base_rate is not set for this room type -- refusing to guess an anchor price",
      });
      continue;
    }

    const cbRoomTypeId = cbRoomTypeIdByVillaRoomType.get(rt.id) ?? null;

    // One AI research call per run at most: Gemini + Google Search takes
    // 10-30s and this deployment is capped at 60s per request, which a
    // push must not lose. The 7-day staleness window means every room
    // type still gets refreshed within a couple of runs.
    const competitorRefresh = await refreshCompetitorDataIfStale(supabase, rt, researchBudget > 0);
    if (competitorRefresh.refreshed || competitorRefresh.error) researchBudget--;

    const decisions = await decideRatesForRoomType(supabase, rt, anchorRate, targetDates, pricingSettings);
    const todayDecision = decisions.find((d) => d.date === today) ?? null;

    let pushed = false;
    let jobReferenceId: string | null = null;
    let verification: AiPricingRoomTypeResult["verification"] = null;
    let error: string | undefined;

    if (!pushRequested) {
      // Dry run: decide and report, touch nothing. The live price keeps
      // following Cloudbeds until the owner switches autopush on.
    } else if (!cbRoomTypeId) {
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
          jobReferenceId = pushResult.jobReferenceId;

          // Read back what Cloudbeds actually stored. putRate's endDate is
          // documented nowhere we can reach, so this proves empirically
          // that [date, date+1) writes exactly one night rather than
          // silently shifting every day's price by one (which overlapping
          // inclusive intervals would do). Cloudbeds processes rate
          // updates asynchronously, so a mismatch here is reported as a
          // warning to check, not treated as a failed push.
          await new Promise((r) => setTimeout(r, 4000));
          // getRate's endDate is EXCLUSIVE (unlike putRate's, which is
          // inclusive), so asking only up to toDate silently omits the
          // last day and reports it as a phantom mismatch every run.
          const readBack = await getCloudbedsRoomTypeRate(cbRoomTypeId, today, addDays(toDate, 1));
          const actualByDate = new Map(readBack.map((r) => [r.date, r.rate]));
          const mismatched = decisions
            .map((d) => ({ date: d.date, expected: d.decided_rate, actual: actualByDate.get(d.date) ?? null }))
            .filter((x) => x.actual === null || Math.round(x.actual) !== x.expected);
          verification = { checked: true, matched_dates: decisions.length - mismatched.length, mismatched: mismatched.slice(0, 5) };
          pushed = true;
        }
      } catch (e) {
        error = e instanceof CloudbedsApiError ? e.message : e instanceof Error ? e.message : String(e);
      }
    }

    results.push({
      villa_room_type_code: rt.code,
      cloudbeds_room_type_id: cbRoomTypeId,
      anchor_rate: anchorRate,
      competitor_refresh: competitorRefresh,
      today_decided_rate: todayDecision?.decided_rate ?? null,
      today_guardrail_status: todayDecision?.guardrail_status ?? null,
      dates_decided: decisions.length,
      pushed_to_cloudbeds: pushed,
      job_reference_id: jobReferenceId,
      verification,
      error,
    });
  }

  // Single writer for local state: whatever Cloudbeds ended up holding is
  // pulled back into villa_rates and units.tarif_harian by the existing
  // sync path, rather than this engine writing its own intended price
  // locally. If Cloudbeds rejected or is still queueing, local prices
  // simply stay as they were -- villa and the OTAs can never silently
  // disagree because of this run.
  let reconciled: RateSyncSummary | null = null;
  if (results.some((r) => r.pushed_to_cloudbeds)) {
    reconciled = await syncCloudbedsRates(supabase);
  }

  return { ok: true, today, window_days: WINDOW_DAYS, autopush_enabled: autopushEnabled, push_requested: pushRequested, results, reconciled };
}
