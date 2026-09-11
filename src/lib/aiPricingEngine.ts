import type { SupabaseClient } from "@supabase/supabase-js";
import { researchCompetitorRates } from "@/lib/aiBridge";

/**
 * Owner instruction (2026-09-11): villa should run its own AI-assisted
 * dynamic pricing -- occupancy rules + AI competitor/market research +
 * the base/min/max guardrails already set per room type (Phase 3) --
 * then push the decided price OUT to Cloudbeds (src/lib/cloudbedsApi.ts
 * pushCloudbedsRate), since Cloudbeds is what actually distributes price
 * to every OTA. This supersedes the old generate-pricing-recommendations
 * cron's PURPOSE (that one only ever wrote a local pending_review row --
 * see PHASE6-DESIGN.md's "no autonomous price change" non-goal, which
 * this deliberately overrides per explicit owner approval) while reusing
 * its occupancy/weekend/high-season math outright, since that logic
 * itself was never the problem.
 *
 * Competitor research reuses the existing AI bridge
 * (src/lib/aiBridge.ts researchCompetitorRates -- Mkhsistem's Gemini +
 * Google Search bridge, not a new AI integration) and needs a location
 * label to search near. That label lives in
 * integration_settings.revenue_engine.location_label (owner-provided,
 * set once via Supabase directly since there's no dedicated settings UI
 * for it yet) -- if unset, competitor refresh is skipped and the engine
 * still runs on occupancy + high season alone, never invented.
 */

const COMPETITOR_STALE_DAYS = 7;
const WEEKEND_SURCHARGE = 100000;

export interface RoomTypeForPricing {
  id: string;
  code: string;
  name: string;
  description: string | null;
  min_rate: number | null;
  max_rate: number | null;
}

export interface PricingSettings {
  max_daily_movement_pct: number;
  high_occupancy_threshold_pct: number;
  high_occupancy_adjustment_pct: number;
  low_occupancy_threshold_pct: number;
  low_occupancy_adjustment_pct: number;
}

export interface DatePriceDecision {
  date: string;
  current_rate: number;
  decided_rate: number;
  reason_codes: string[];
  guardrail_status: "within_range" | "clamped_min" | "clamped_max" | "clamped_movement";
  occupancy_pct: number;
}

function isWeekendJakarta(dateStr: string): boolean {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6; // Jumat/Sabtu, per earlier owner instruction
}

/**
 * Refreshes villa_competitor_rates for a room type via AI research if the
 * most recent observation is older than COMPETITOR_STALE_DAYS (or
 * missing) -- avoids calling the AI bridge on every single cron run.
 * Silently no-ops (returns false) if no location label is configured,
 * rather than guessing one.
 */
export async function refreshCompetitorDataIfStale(supabase: SupabaseClient, roomType: RoomTypeForPricing): Promise<boolean> {
  const { data: settingRow } = await supabase.from("integration_settings").select("value").eq("key", "revenue_engine").maybeSingle();
  const locationLabel = (settingRow?.value as { location_label?: string } | undefined)?.location_label;
  if (!locationLabel) return false;

  const staleSince = new Date(Date.now() - COMPETITOR_STALE_DAYS * 86400000).toISOString().slice(0, 10);
  const { data: recent } = await supabase
    .from("villa_competitor_rates")
    .select("id")
    .eq("room_type_id", roomType.id)
    .gte("observed_at", staleSince)
    .limit(1);
  if (recent && recent.length > 0) return false;

  const results = await researchCompetitorRates({
    location_label: locationLabel,
    room_type_name: roomType.name,
    room_type_description: roomType.description ?? "",
  });
  if (results.length === 0) return false;

  await supabase.from("villa_competitor_rates").insert(
    results.map((r) => ({
      room_type_id: roomType.id,
      location_label: locationLabel,
      competitor_name: r.competitor_name.slice(0, 200),
      competitor_type: (["hotel", "villa", "other"].includes(r.competitor_type) ? r.competitor_type : "other") as "hotel" | "villa" | "other",
      price: r.price,
      currency: "IDR",
      source: "ai_research" as const,
      source_note: r.source_note?.slice(0, 500) ?? null,
      observed_at: new Date().toISOString().slice(0, 10),
      created_by: "ai_dynamic_pricing_cron",
    })),
  );
  return true;
}

/**
 * Computes the decided rate for one room type across a set of target
 * dates -- occupancy-driven delta (clamped to max_daily_movement_pct),
 * weekend surcharge, high-season floor, competitor-market floor during
 * high season, always clamped last to the room type's min_rate/max_rate.
 * Mirrors the old generate-pricing-recommendations math exactly (that
 * logic was correct -- only its "write a pending row and stop" ending
 * changes here, replaced by the caller pushing the result to Cloudbeds).
 */
export async function decideRatesForRoomType(
  supabase: SupabaseClient,
  roomType: RoomTypeForPricing,
  currentRate: number,
  targetDates: string[],
  settings: PricingSettings,
): Promise<DatePriceDecision[]> {
  const { data: allBookings } = await supabase
    .from("bookings")
    .select("unit_id, tgl_checkin, tgl_checkout, status")
    .neq("status", "batal");
  const { data: units } = await supabase.from("units").select("id").eq("room_type_id", roomType.id);
  const unitIds = new Set((units ?? []).map((u) => u.id));

  const today = targetDates[0] ?? new Date().toISOString().slice(0, 10);
  const toDate = targetDates[targetDates.length - 1] ?? today;
  const { data: highSeasonPeriods } = await supabase
    .from("villa_high_season_periods")
    .select("start_date, end_date, suggested_adjustment_pct")
    .eq("active", true)
    .lte("start_date", toDate)
    .gte("end_date", today);

  const competitorSince = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: competitorRates } = await supabase
    .from("villa_competitor_rates")
    .select("price, observed_at")
    .eq("room_type_id", roomType.id)
    .gte("observed_at", competitorSince);
  const competitorAvg =
    competitorRates && competitorRates.length > 0 ? competitorRates.reduce((sum, r) => sum + Number(r.price), 0) / competitorRates.length : null;

  function highSeasonPeriodFor(dateStr: string) {
    return (highSeasonPeriods ?? []).find((p) => p.start_date <= dateStr && p.end_date >= dateStr) ?? null;
  }

  const results: DatePriceDecision[] = [];
  for (const targetDate of targetDates) {
    const activeForDate = (allBookings ?? []).filter(
      (b) =>
        unitIds.has(b.unit_id) &&
        (b.status === "terjadwal" || b.status === "checkin") &&
        b.tgl_checkin <= targetDate &&
        (!b.tgl_checkout || b.tgl_checkout > targetDate),
    );
    const occupancyPct = unitIds.size > 0 ? Math.round((activeForDate.length / unitIds.size) * 1000) / 10 : 0;

    let deltaPct = 0;
    const reasonCodes: string[] = [];
    if (occupancyPct >= settings.high_occupancy_threshold_pct) {
      deltaPct = settings.high_occupancy_adjustment_pct;
      reasonCodes.push("high_occupancy");
    } else if (occupancyPct <= settings.low_occupancy_threshold_pct) {
      deltaPct = settings.low_occupancy_adjustment_pct;
      reasonCodes.push("low_occupancy");
    }

    let clampedDelta = deltaPct;
    let guardrailStatus: DatePriceDecision["guardrail_status"] = "within_range";
    if (Math.abs(clampedDelta) > settings.max_daily_movement_pct) {
      clampedDelta = Math.sign(clampedDelta) * settings.max_daily_movement_pct;
      guardrailStatus = "clamped_movement";
    }

    let decidedRate = Math.round(currentRate * (1 + clampedDelta));

    if (isWeekendJakarta(targetDate)) {
      decidedRate += WEEKEND_SURCHARGE;
      reasonCodes.push("weekend");
    }

    const highSeasonPeriod = highSeasonPeriodFor(targetDate);
    if (highSeasonPeriod) {
      const floor = Math.round(currentRate * (1 + Number(highSeasonPeriod.suggested_adjustment_pct)));
      if (floor > decidedRate) decidedRate = floor;
      reasonCodes.push("high_season");
      if (competitorAvg !== null && Math.round(competitorAvg) > decidedRate) {
        decidedRate = Math.round(competitorAvg);
        reasonCodes.push("competitor_market_rate");
      }
    }

    const minRate = roomType.min_rate !== null ? Number(roomType.min_rate) : null;
    const maxRate = roomType.max_rate !== null ? Number(roomType.max_rate) : null;
    if (minRate !== null && decidedRate < minRate) {
      decidedRate = minRate;
      guardrailStatus = "clamped_min";
    }
    if (maxRate !== null && decidedRate > maxRate) {
      decidedRate = maxRate;
      guardrailStatus = "clamped_max";
    }

    results.push({ date: targetDate, current_rate: currentRate, decided_rate: decidedRate, reason_codes: reasonCodes, guardrail_status: guardrailStatus, occupancy_pct: occupancyPct });
  }
  return results;
}
