import type { SupabaseClient } from "@supabase/supabase-js";
import { researchCompetitorRates, researchMarketDemand, type DemandTrend } from "@/lib/aiBridge";

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
const MARKET_DEMAND_STALE_DAYS = 7;
const WEEKEND_SURCHARGE = 100000;
const MARKET_DEMAND_CREATED_BY = "ai_jogja_events_research";

/**
 * Certain, yearly seasonal peaks (New Year, Lebaran, school holidays)
 * get their own created_by so decideRatesForRoomType can price them
 * ahead of time, while ordinary AI-found events still have to earn
 * their uplift from real pickup. Same table, same column, a second
 * value -- no schema change.
 */
const MARKET_DEMAND_RECURRING_CREATED_BY = "ai_recurring_peak";
const AI_PERIOD_CREATED_BY = [MARKET_DEMAND_CREATED_BY, MARKET_DEMAND_RECURRING_CREATED_BY];

// AI never outputs a raw percentage for an event -- only a qualitative
// impact rating -- so a bad/exaggerated model response can move price by
// at most this much, deliberately, rather than trusting an arbitrary
// number from a web-search summary. Same order of magnitude as the
// manually-entered high-season periods already in this table.
const EVENT_IMPACT_ADJUSTMENT_PCT: Record<"low" | "medium" | "high", number> = { low: 0.05, medium: 0.1, high: 0.2 };

/**
 * Owner instruction (2026-09-12), after 16/22/23 Sep were pushed to the
 * ceiling (Standard Rp1,000,000, Sawah View Rp1,055,546) purely because
 * an event fell on those dates: "jangan hanya karena ada event dinaikkan
 * drastis, perhatikan semua indikator yang membuat harga naik".
 *
 * That matches how revenue management actually works. A calendar event
 * is a HYPOTHESIS about demand, not demand itself. Real operators raise
 * price on PICKUP -- rooms actually selling for that date -- and treat
 * the event only as a reason to expect pickup sooner. A date with an
 * event and no bookings is still an empty date, and pricing it at the
 * ceiling is the fastest way to keep it empty.
 *
 * So an event uplift now has to be EARNED by occupancy on that same
 * date:
 *   occupancy >= EVENT_DEMAND_FULL_PCT -> full uplift (demand confirmed)
 *   occupancy >= EVENT_DEMAND_HALF_PCT -> half uplift (demand building)
 *   below that, or during cold start   -> no uplift at all
 */
const EVENT_DEMAND_FULL_PCT = 50;
const EVENT_DEMAND_HALF_PCT = 25;

/**
 * ...with one deliberate exception, added 2026-09-12 alongside the
 * year-long pricing horizon.
 *
 * "Earn it with pickup" is the right rule for a SPECULATIVE period -- an
 * event the AI found by searching the web, which may or may not move
 * accommodation demand at all. It is the wrong rule for a STRUCTURAL one:
 * New Year, Lebaran and the long national holidays are certain, they
 * recur every year, and the whole industry publishes higher rates for
 * them months in advance. Waiting for pickup there means selling the
 * peak at base rate to whoever books first.
 *
 * The two are distinguishable from created_by alone, with no schema
 * change: an ordinary AI-found event is stamped
 * 'ai_jogja_events_research', a certain yearly peak the research
 * identified as recurring is stamped 'ai_recurring_peak', and anything
 * else means a human entered the period deliberately. The last two apply
 * in full straight away; only the first has to be earned. All three stay
 * bounded by min_rate/max_rate and by the daily movement clamp.
 */
function appliesWithoutPickup(createdBy: string | null | undefined): boolean {
  // Anything that is not an ordinary AI-found event: an owner-entered
  // period (their own rate plan) or a certain recurring seasonal peak.
  return (createdBy ?? "") !== MARKET_DEMAND_CREATED_BY;
}

/**
 * Same incident: "Standard" had exactly ONE villa comparable in
 * villa_competitor_rates (Rp1,000,000) and "Sawah View" had three, one
 * of which (Ubu Villa Gito Gati, Rp1,631,615) was double the other two.
 * A mean over that sample is not a market rate, it is an anecdote.
 *
 * Two corrections: require a real sample before the competitor band is
 * used at all, and use the MEDIAN so a single luxury outlier cannot set
 * our price. The band is also a CAP only -- never a floor. Charging more
 * than the neighbours because a thin sample says they are expensive is
 * exactly the mistake this replaces; min_rate still protects the floor.
 */
const COMPETITOR_MIN_SAMPLES = 3;

/**
 * Close to arrival an empty date is a problem to solve, not an
 * opportunity to price up: there is no longer time for demand to
 * materialise. Inside this window, a date that is still under
 * NEAR_ARRIVAL_MIN_OCC_PCT never gets priced above what it is already
 * selling at, whatever the event calendar says.
 */
const NEAR_ARRIVAL_DAYS = 7;
const NEAR_ARRIVAL_MIN_OCC_PCT = 30;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
}

/**
 * Owner instruction (2026-09-11, ahead of the 20 Sep opening): hold the
 * low-occupancy discount until there is real booking history. A brand
 * new villa is empty by definition, so without this the engine would
 * read "0% occupancy" on day one and immediately sell at the floor,
 * before the market has ever seen the normal price.
 *
 * The threshold reuses this codebase's existing "not enough data yet"
 * boundary -- the <20 bookings = confidence 'low' rule the Phase 6
 * engine already used -- rather than inventing a new number. The
 * high-occupancy INCREASE is deliberately not held back: if rooms are
 * filling up, raising the price is safe whatever the history.
 */
const COLD_START_MIN_BOOKINGS = 20;

export interface RoomTypeForPricing {
  id: string;
  code: string;
  name: string;
  description: string | null;
  base_rate: number | null;
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
  anchor_rate: number;
  decided_rate: number;
  reason_codes: string[];
  guardrail_status: "within_range" | "clamped_min" | "clamped_max" | "clamped_movement";
  occupancy_pct: number;
}

export interface CompetitorRefreshResult {
  refreshed: boolean;
  rows_inserted?: number;
  skipped_reason?: string;
  error?: string;
}

export interface MarketDemandRefreshResult {
  refreshed: boolean;
  demand_trend?: DemandTrend;
  trend_note?: string;
  events_upserted?: number;
  skipped_reason?: string;
  error?: string;
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
export async function refreshCompetitorDataIfStale(
  supabase: SupabaseClient,
  roomType: RoomTypeForPricing,
  allowResearch = true,
): Promise<CompetitorRefreshResult> {
  if (!allowResearch) return { refreshed: false, skipped_reason: "research budget used this run (Vercel 60s limit)" };
  const { data: settingRow } = await supabase.from("integration_settings").select("value").eq("key", "revenue_engine").maybeSingle();
  const locationLabel = (settingRow?.value as { location_label?: string } | undefined)?.location_label;
  if (!locationLabel) return { refreshed: false, skipped_reason: "no location_label configured" };

  const staleSince = new Date(Date.now() - COMPETITOR_STALE_DAYS * 86400000).toISOString().slice(0, 10);
  const { data: recent } = await supabase
    .from("villa_competitor_rates")
    .select("id")
    .eq("room_type_id", roomType.id)
    .gte("observed_at", staleSince)
    .limit(1);
  if (recent && recent.length > 0) return { refreshed: false, skipped_reason: "existing data still fresh" };

  let results: Awaited<ReturnType<typeof researchCompetitorRates>>;
  try {
    results = await researchCompetitorRates({
      location_label: locationLabel,
      room_type_name: roomType.name,
      room_type_description: roomType.description ?? "",
    });
  } catch (e) {
    // Surfaced, never swallowed: a silent failure here meant the owner's
    // core ask (AI learning the market) was quietly not happening at all.
    return { refreshed: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (results.length === 0) return { refreshed: false, skipped_reason: "AI returned no competitor rows" };

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
  return { refreshed: true, rows_inserted: results.length };
}

/**
 * Refreshes villa_high_season_periods with AI-detected upcoming Jogja
 * events, once per run at most (not per room type -- this is location-
 * wide, not room-type-specific), if the most recent AI-sourced period
 * is older than MARKET_DEMAND_STALE_DAYS or none exists yet. Rows are
 * tagged created_by=MARKET_DEMAND_CREATED_BY so they read exactly like
 * any other high-season period to decideRatesForRoomType below, but
 * stay distinguishable from a manual admin entry. Matched by
 * (label, start_date) on refresh -- the table has no unique constraint
 * for this, so this check-then-write avoids piling up duplicates every
 * time the research reruns.
 */
export async function refreshMarketDemandIfStale(supabase: SupabaseClient, allowResearch = true): Promise<MarketDemandRefreshResult> {
  if (!allowResearch) return { refreshed: false, skipped_reason: "research budget used this run (Vercel 60s limit)" };
  const { data: settingRow } = await supabase.from("integration_settings").select("value").eq("key", "revenue_engine").maybeSingle();
  const locationLabel = (settingRow?.value as { location_label?: string } | undefined)?.location_label;
  if (!locationLabel) return { refreshed: false, skipped_reason: "no location_label configured" };

  const staleSince = new Date(Date.now() - MARKET_DEMAND_STALE_DAYS * 86400000).toISOString();
  const { data: recent } = await supabase
    .from("villa_high_season_periods")
    .select("id")
    .in("created_by", AI_PERIOD_CREATED_BY)
    .gte("created_at", staleSince)
    .limit(1);
  if (recent && recent.length > 0) return { refreshed: false, skipped_reason: "existing data still fresh" };

  let result: Awaited<ReturnType<typeof researchMarketDemand>>;
  try {
    result = await researchMarketDemand(locationLabel);
  } catch (e) {
    return { refreshed: false, error: e instanceof Error ? e.message : String(e) };
  }

  let upserted = 0;
  for (const ev of result.events) {
    const { data: existing } = await supabase
      .from("villa_high_season_periods")
      .select("id")
      .in("created_by", AI_PERIOD_CREATED_BY)
      .eq("label", ev.label)
      .eq("start_date", ev.start_date)
      .maybeSingle();
    const row = {
      label: ev.label,
      start_date: ev.start_date,
      end_date: ev.end_date,
      suggested_adjustment_pct: EVENT_IMPACT_ADJUSTMENT_PCT[ev.expected_impact],
      active: true,
      created_by: ev.certainty === "recurring" ? MARKET_DEMAND_RECURRING_CREATED_BY : MARKET_DEMAND_CREATED_BY,
    };
    if (existing) {
      await supabase.from("villa_high_season_periods").update(row).eq("id", existing.id);
    } else {
      await supabase.from("villa_high_season_periods").insert(row);
    }
    upserted++;
  }

  return { refreshed: true, demand_trend: result.demand_trend, trend_note: result.trend_note, events_upserted: upserted };
}

/**
 * Computes the decided rate for one room type across a set of target
 * dates, in the order a revenue manager would reason in:
 *   1. stable anchor (base_rate)
 *   2. weekend surcharge  -- a known, permanent pattern
 *   3. realised demand    -- occupancy actually picked up for that date
 *   4. event uplift       -- only the share demand has EARNED (step 3)
 *   5. competitor median  -- a sanity CAP, never a floor
 *   6. near-arrival guard -- an empty date close in is never priced up
 *   7. movement clamp     -- vs. what the date sells at TODAY
 *   8. min_rate/max_rate  -- the owner's hard guardrails, always last
 *
 * Steps 4-7 are the 2026-09-12 rewrite. Before it, an event put the
 * date into "high season", where the competitor average acted as a
 * FLOOR and bypassed the movement clamp entirely -- which pushed
 * 16/22/23 Sep from Rp650,000 to the Rp1,000,000 ceiling in a single
 * run, live on every OTA, on dates with zero bookings. The rule that
 * replaces it: an event is a reason to EXPECT demand, only pickup is a
 * reason to charge for it.
 *
 * `anchorRate` MUST be a stable value the engine never writes to
 * (villa_room_types.base_rate) -- passing units.tarif_harian here, as
 * the first version did, made every run compound on the previous run's
 * output and ratchet the price toward max_rate on Fri/Sat regardless of
 * occupancy (see 20260911000001_pricing_base_rate_and_autopush.sql).
 * With a fixed anchor this function is idempotent: same inputs, same
 * price, however many times it runs in a day.
 */
export async function decideRatesForRoomType(
  supabase: SupabaseClient,
  roomType: RoomTypeForPricing,
  anchorRate: number,
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
    .select("start_date, end_date, suggested_adjustment_pct, created_by")
    .eq("active", true)
    .lte("start_date", toDate)
    .gte("end_date", today);

  // Owner correction (2026-09-11): a hotel's per-room rate isn't a fair
  // comparison for a private villa unit -- one hotel sample (Rp351,074)
  // dragged the average for a Rp1,000,000 villa competitor down to
  // Rp675,537, which then cut a real Saturday price the same day this
  // ran. Only "villa" competitors count toward the price band now.
  //
  // Owner correction (2026-09-12): and only when there are enough of
  // them to be a market rather than an anecdote, using the median so one
  // luxury villa can't set our price. See COMPETITOR_MIN_SAMPLES.
  const competitorSince = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: competitorRates } = await supabase
    .from("villa_competitor_rates")
    .select("price, observed_at")
    .eq("room_type_id", roomType.id)
    .eq("competitor_type", "villa")
    .gte("observed_at", competitorSince);
  const competitorPrices = (competitorRates ?? []).map((r) => Number(r.price)).filter((n) => Number.isFinite(n) && n > 0);
  const competitorMedian = competitorPrices.length >= COMPETITOR_MIN_SAMPLES ? median(competitorPrices) : null;

  // The price each date is actually selling at right now. Every guardrail
  // that talks about "how far price may move" is measured against THIS,
  // not against the anchor -- the 16/22/23 Sep incident moved price
  // +54% in one run precisely because the event and competitor branches
  // wrote an absolute number that never passed through the movement
  // clamp at all.
  const { data: liveRates } = await supabase
    .from("villa_rates")
    .select("date, rate")
    .eq("room_type_id", roomType.id)
    .gte("date", today)
    .lte("date", toDate);
  const liveRateByDate = new Map((liveRates ?? []).map((r) => [String(r.date), Number(r.rate)]));

  function highSeasonPeriodFor(dateStr: string) {
    return (highSeasonPeriods ?? []).find((p) => p.start_date <= dateStr && p.end_date >= dateStr) ?? null;
  }

  const coldStart = (allBookings ?? []).length < COLD_START_MIN_BOOKINGS;

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

    const reasonCodes: string[] = [];
    let guardrailStatus: DatePriceDecision["guardrail_status"] = "within_range";

    // --- 1. Start from the stable anchor, never from the last price ---
    let decidedRate = anchorRate;

    // --- 2. Day-of-week seasonality (a known, permanent pattern) ---
    if (isWeekendJakarta(targetDate)) {
      decidedRate += WEEKEND_SURCHARGE;
      reasonCodes.push("weekend");
    }

    // The owner's own rate plan: base rate plus the weekend pattern,
    // before any demand or event adjustment. Nothing below is allowed to
    // price UNDER this on the strength of competitor research alone.
    const structuralRate = decidedRate;

    // --- 3. Realised demand for THIS date (pickup) ---
    let demandPct = 0;
    if (occupancyPct >= settings.high_occupancy_threshold_pct) {
      demandPct = settings.high_occupancy_adjustment_pct;
      reasonCodes.push("high_occupancy");
    } else if (occupancyPct <= settings.low_occupancy_threshold_pct) {
      if (coldStart) {
        reasonCodes.push("cold_start_hold");
      } else {
        demandPct = settings.low_occupancy_adjustment_pct;
        reasonCodes.push("low_occupancy");
      }
    }
    decidedRate = Math.round(decidedRate * (1 + demandPct));

    // --- 4. Event uplift, but only as far as demand has earned it ---
    const highSeasonPeriod = highSeasonPeriodFor(targetDate);
    if (highSeasonPeriod) {
      reasonCodes.push("high_season");
      const eventPct = Number(highSeasonPeriod.suggested_adjustment_pct) || 0;
      let earnedShare = 0;
      if (appliesWithoutPickup(highSeasonPeriod.created_by)) {
        // An owner-entered period, or a certain yearly peak like New Year
        // or Lebaran. Both are priced ahead of time on purpose and are
        // not subject to the pickup test -- guests book these months out,
        // so waiting for pickup means selling the peak at base rate.
        earnedShare = 1;
        reasonCodes.push(highSeasonPeriod.created_by === MARKET_DEMAND_RECURRING_CREATED_BY ? "recurring_peak" : "owner_high_season");
      } else if (coldStart) {
        reasonCodes.push("event_uplift_held_cold_start");
      } else if (occupancyPct >= EVENT_DEMAND_FULL_PCT) {
        earnedShare = 1;
        reasonCodes.push("event_demand_confirmed");
      } else if (occupancyPct >= EVENT_DEMAND_HALF_PCT) {
        earnedShare = 0.5;
        reasonCodes.push("event_demand_building");
      } else {
        reasonCodes.push("event_demand_unproven");
      }
      if (earnedShare > 0) decidedRate = Math.round(decidedRate * (1 + eventPct * earnedShare));
    }

    // --- 5. Competitor band: a sanity CAP, never a floor ---
    //
    // The cap restrains OUR optimism -- it trims an uplift we added on
    // top of the rate plan. It is not allowed to undercut the rate plan
    // itself: on 2026-09-11 a thin competitor sample cut a real Saturday
    // price, and the median alone does not prevent that (the three Sawah
    // View comparables median to Rp809,281, below our own Rp850,000
    // Saturday). Hence max() against structuralRate.
    //
    // And it does not apply on a certain peak at all. villa_competitor_
    // rates holds an ORDINARY nightly price: the research prompt asks for
    // "harga per malam publik" with no stay date, so the sample describes
    // a normal night, not New Year. Capping a New Year price with it
    // compares two different things -- and did: Sawah View's whole
    // Christmas/New Year period came out at Rp809,281, with Fri/Sat
    // getting no uplift whatsoever because the cap landed exactly on the
    // ordinary weekend price. Everybody raises rates over New Year, so an
    // off-peak observation is not evidence about that date. min_rate,
    // max_rate and the movement clamp still bound these dates; the cap
    // resumes on every ordinary night, which is what it is for.
    const competitorCapApplies = competitorMedian !== null && !(highSeasonPeriod && appliesWithoutPickup(highSeasonPeriod.created_by));
    if (competitorCapApplies && competitorMedian !== null) {
      const cap = Math.max(Math.round(competitorMedian), structuralRate);
      if (decidedRate > cap) {
        decidedRate = cap;
        reasonCodes.push("competitor_market_cap");
      }
    }

    // --- 6. Close to arrival and still empty: never price up ---
    const liveRate = liveRateByDate.get(targetDate) ?? null;
    const daysToArrival = daysBetween(today, targetDate);
    if (liveRate !== null && daysToArrival <= NEAR_ARRIVAL_DAYS && occupancyPct < NEAR_ARRIVAL_MIN_OCC_PCT && decidedRate > liveRate) {
      decidedRate = liveRate;
      reasonCodes.push("near_arrival_no_increase");
    }

    // --- 7. Movement clamp against what the date sells at TODAY ---
    //
    // The clamp exists so price never LURCHES -- "jangan dinaikkan
    // drastis". It deliberately does not apply to a move that lands
    // between today's live price and the anchor, because that is a
    // correction back toward the owner's own base rate, not a swing away
    // from it. Without this exception the clamp would actively slow down
    // undoing a bad price: recovering 16 Sep from the Rp1,000,000
    // ceiling to Rp650,000 would have taken three days of -15% steps,
    // with the wrong price live on every OTA the whole time.
    const anchorSide = Math.min(anchorRate, liveRate ?? anchorRate);
    const liveSide = Math.max(anchorRate, liveRate ?? anchorRate);
    const isCorrectionTowardAnchor = liveRate !== null && decidedRate >= anchorSide && decidedRate <= liveSide;

    if (liveRate !== null && liveRate > 0 && !isCorrectionTowardAnchor) {
      const maxUp = Math.round(liveRate * (1 + settings.max_daily_movement_pct));
      const maxDown = Math.round(liveRate * (1 - settings.max_daily_movement_pct));
      if (decidedRate > maxUp) {
        decidedRate = maxUp;
        guardrailStatus = "clamped_movement";
      } else if (decidedRate < maxDown) {
        decidedRate = maxDown;
        guardrailStatus = "clamped_movement";
      }
    }

    // --- 8. Owner's hard guardrails always win, last ---
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

    results.push({ date: targetDate, anchor_rate: anchorRate, decided_rate: decidedRate, reason_codes: reasonCodes, guardrail_status: guardrailStatus, occupancy_pct: occupancyPct });
  }
  return results;
}
