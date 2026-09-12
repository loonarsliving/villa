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
/** Declared here because AI_PERIOD_CREATED_BY below needs it; see SIGNAL 1. */
const LOW_SEASON_CREATED_BY = "ai_low_season";

/**
 * Certain, yearly seasonal peaks (New Year, Lebaran, school holidays)
 * get their own created_by so decideRatesForRoomType can price them
 * ahead of time, while ordinary AI-found events still have to earn
 * their uplift from real pickup. Same table, same column, a second
 * value -- no schema change.
 */
const MARKET_DEMAND_RECURRING_CREATED_BY = "ai_recurring_peak";
const AI_PERIOD_CREATED_BY = [MARKET_DEMAND_CREATED_BY, MARKET_DEMAND_RECURRING_CREATED_BY, LOW_SEASON_CREATED_BY];

/** A trough is as certain as a peak, so it carries the same weight class. */
const LOW_SEASON_IMPACT_ADJUSTMENT_PCT: Record<"low" | "medium" | "high", number> = { low: -0.05, medium: -0.1, high: -0.2 };

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

/**
 * Owner instruction (2026-09-12): the engine should reason from more of
 * the signals a real revenue manager watches -- search interest for
 * villas in Jogja, competitor rates, event/holiday news, AND the quiet
 * months like Ramadan -- not just occupancy, and it is allowed to set
 * the price itself as long as min_rate holds the floor.
 *
 * Three signals were missing entirely before this change. Each one is
 * added below with its own bound, so no single signal -- least of all a
 * qualitative one a language model produced -- can move price far on its
 * own.
 */

/**
 * SIGNAL 1: low season (a period that moves demand DOWN).
 *
 * villa_high_season_periods stores a signed suggested_adjustment_pct and
 * has no CHECK forcing it positive (verified against the live schema),
 * so a trough is the same row shape with a negative percentage and its
 * own created_by. No migration, no new table -- the same deliberate
 * reuse the AI-found event rows already make of this table.
 *
 * The rule that governs it is the MIRROR of the event rule, not a copy:
 *  - an UPLIFT has to be earned by pickup, because charging more for
 *    demand that never shows up leaves the date empty;
 *  - a DISCOUNT is applied straight away, because the whole point is to
 *    attract demand that is not there yet -- waiting for pickup to
 *    discount is waiting for something that by definition will not come.
 * ...but it is withdrawn the moment the date proves it does not need it
 * (LOW_SEASON_SUPPRESS_OCC_PCT): a Ramadan weekend that fills up anyway
 * should not be sold at a discount.
 *
 * min_rate still bounds it, so "bulan puasa" can never price below the
 * owner's floor.
 */
const LOW_SEASON_SUPPRESS_OCC_PCT = 50;

/**
 * SIGNAL 2: search/market interest (researchMarketDemand's demand_trend).
 *
 * This has been researched every run since 2026-09-11 and then THROWN
 * AWAY -- refreshMarketDemandIfStale returned it, runAiDynamicPricing
 * reported it in the run summary, and no code path ever let it touch a
 * price. The owner asked specifically for "seberapa banyak orang mencari
 * villa di jogja" to count, so it now does.
 *
 * Deliberately the smallest adjustment in this file. It is a qualitative
 * naik/turun/stabil read from a web-search summary, covering the market
 * as a whole with no date attached -- weaker evidence than this villa's
 * own pickup on the actual date, so it gets a nudge, not a lever.
 */
const MARKET_TREND_ADJUSTMENT_PCT = 0.03;

/**
 * SIGNAL 3: lead time -- the one Duetto-style idea the engine lacked
 * most.
 *
 * Occupancy alone is not a demand signal; occupancy AT A GIVEN LEAD TIME
 * is. An empty date 200 days out is not a problem, it is a date nobody
 * has had a reason to book yet -- discounting it gives away money for
 * nothing and, worse, teaches the OTAs a low price for a date that had
 * every chance of selling at full rate. The same emptiness three days
 * out is a genuine distress signal: there is no time left for demand to
 * arrive.
 *
 * Before this, low_occupancy_adjustment_pct applied identically at H-300
 * and H-3. Now the discount ramps in as arrival approaches:
 *   <= FULL days  -> full discount (last chance to fill it)
 *   <= HALF days  -> half discount (softly stimulating)
 *   beyond that   -> none at all (still far too early to panic)
 *
 * The high-occupancy INCREASE is deliberately NOT ramped: filling up
 * early is the strongest demand signal there is, and the existing
 * movement clamp and max_rate already bound how fast it can act.
 */
const DISCOUNT_LEAD_TIME_FULL_DAYS = 14;
const DISCOUNT_LEAD_TIME_HALF_DAYS = 45;

/**
 * SIGNAL 4: pace -- seberapa cepat sebuah tanggal menumpuk dibanding
 * tanggal pembanding pada JARAK HARI YANG SAMA.
 *
 * Ini sinyal paling dini yang bisa dimiliki: ia bergerak jauh sebelum
 * okupansi terlihat tinggi. "Sudah 2 dari 10 terjual" tidak berarti apa-apa
 * sendirian; "sudah 2 terjual padahal biasanya di H-30 baru 0,5" adalah
 * permintaan yang sedang datang lebih cepat dari biasanya.
 *
 * Dihitung dari `bookings.created_at`, BUKAN dari
 * `villa_daily_inventory_snapshot`. Snapshot hanya merekam keadaan hari
 * itu, jadi ia tidak bisa menjawab "20 Oktober sudah seramai apa waktu
 * kita masih 30 hari sebelumnya". `created_at` bisa menjawabnya secara
 * surut, tanpa menunggu berbulan-bulan mengumpulkan snapshot baru.
 *
 * Dipisah weekend/bukan-weekend: membandingkan Sabtu dengan Selasa akan
 * membuat setiap Sabtu terlihat "lebih cepat dari biasanya" selamanya.
 */
const PACE_MIN_COMPARABLE_DATES = 6;
const PACE_MIN_HISTORY_BOOKINGS = 15;
/** Jendela hari-sebelum-menginap yang dipakai membandingkan pace. */
const PACE_LEAD_BUCKETS = [7, 14, 30, 60, 90];
/** Sejauh mana pace boleh mengusulkan pergerakan harga, sebelum digabung. */
const PACE_MAX_ADJUSTMENT_PCT = 0.08;
/** Selisih pace yang dianggap berarti (bukan derau satu-dua booking). */
const PACE_SIGNIFICANT_RATIO = 0.25;

/**
 * Indeks minat pasar per bulan (0-100), disimpan di
 * `integration_settings.villa_market_search_index`.
 *
 * Ini versi BERANGKA dari SINYAL 2. Keduanya menjawab pertanyaan yang
 * sama -- seberapa ramai orang mencari villa di Jogja -- tapi indeks ini
 * tahu bedanya Juli dan Februari, sementara `demand_trend` hanya satu kata
 * untuk seluruh tahun. Maka indeks dipakai lebih dulu, dan `demand_trend`
 * hanya menggantikannya kalau indeksnya belum ada. Tidak pernah keduanya
 * sekaligus: itu akan menghitung sinyal yang sama dua kali.
 *
 * Sengaja di settings, bukan tabel baru: isinya cuma belasan angka yang
 * disegarkan berkala, dan menambah tabel berarti mengubah skema -- yang di
 * proyek ini butuh izin owner lebih dulu.
 */
const MARKET_SEARCH_SETTINGS_KEY = "villa_market_search_index";
/** Batas gerak minat pasar. Paling kecil: ia mengukur seluruh Jogja, bukan villa kita. */
const MARKET_SEARCH_MAX_ADJUSTMENT_PCT = 0.05;
const MARKET_SEARCH_STALE_DAYS = 45;

/**
 * Bobot penggabungan sinyal permintaan.
 *
 * Okupansi paling berat karena ia satu-satunya yang mengukur uang yang
 * benar-benar sudah masuk untuk tanggal itu; minat pasar paling ringan
 * karena ia mengukur seluruh Jogja, bukan villa kita.
 *
 * Aturan yang membuat lapisan ini tidak berbahaya: sinyal tanpa data TIDAK
 * dianggap netral lalu ikut menarik rata-rata ke nol -- ia tidak ikut sama
 * sekali, dan bobot sisanya dinormalkan. Menganggap "tidak tahu" sebagai
 * "biasa saja" adalah cara paling halus untuk membuat sistem percaya diri
 * pada data yang tidak ada.
 */
const SIGNAL_WEIGHTS = { occupancy: 0.6, pace: 0.28, market_search: 0.12 } as const;

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
  /** One plain-Indonesian sentence explaining this date's price, built from reason_codes. */
  reason_text: string;
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
  search_index_months?: number;
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

    // A trough and a peak are the same row with opposite signs. `direction`
    // missing means "naik" -- see the MarketDemandEvent doc comment: a
    // bridge deployment older than this change only ever reported peaks,
    // and must not have its peaks silently reinterpreted as discounts.
    const isLowSeason = ev.direction === "turun";
    const row = {
      label: ev.label,
      start_date: ev.start_date,
      end_date: ev.end_date,
      suggested_adjustment_pct: isLowSeason ? LOW_SEASON_IMPACT_ADJUSTMENT_PCT[ev.expected_impact] : EVENT_IMPACT_ADJUSTMENT_PCT[ev.expected_impact],
      active: true,
      created_by: isLowSeason ? LOW_SEASON_CREATED_BY : ev.certainty === "recurring" ? MARKET_DEMAND_RECURRING_CREATED_BY : MARKET_DEMAND_CREATED_BY,
    };
    if (existing) {
      await supabase.from("villa_high_season_periods").update(row).eq("id", existing.id);
    } else {
      await supabase.from("villa_high_season_periods").insert(row);
    }
    upserted++;
  }

  // The market-interest read is persisted, not just returned. Research runs
  // at most once a week (MARKET_DEMAND_STALE_DAYS) while pricing is decided
  // every night, so a signal that lived only in this function's return value
  // could never reach decideRatesForRoomType -- which is exactly why
  // demand_trend was researched from 2026-09-11 onward and never once
  // affected a price. Stored alongside location_label in the settings row
  // this module already reads, so no new table is needed.
  // Indeks berangka, kalau jembatannya mengirimkannya. Kunci settings-nya
  // terpisah dari revenue_engine karena isinya disegarkan dan dibaca
  // sendiri, dan supaya ketiadaannya mudah dibedakan dari "belum diriset".
  if (result.search_index_by_month) {
    await supabase.from("integration_settings").upsert(
      {
        key: MARKET_SEARCH_SETTINGS_KEY,
        value: { by_month: result.search_index_by_month, researched_at: new Date().toISOString(), source: "ai_market_demand_research" },
      },
      { onConflict: "key" },
    );
  }

  const { data: settingRowNow } = await supabase.from("integration_settings").select("value").eq("key", "revenue_engine").maybeSingle();
  const existingValue = (settingRowNow?.value ?? {}) as Record<string, unknown>;
  await supabase
    .from("integration_settings")
    .update({
      value: {
        ...existingValue,
        market_demand: { trend: result.demand_trend, note: result.trend_note.slice(0, 500), observed_at: new Date().toISOString() },
      },
    })
    .eq("key", "revenue_engine");

  return {
    refreshed: true,
    demand_trend: result.demand_trend,
    trend_note: result.trend_note,
    events_upserted: upserted,
    search_index_months: result.search_index_by_month ? Object.keys(result.search_index_by_month).length : 0,
  };
}

/**
 * How stale a stored market-interest read may be before the engine stops
 * believing it. Research refreshes weekly; if it has been failing for a
 * month the right behaviour is to fall back to "no opinion" rather than
 * keep nudging every price on a reading from a different season.
 */
const MARKET_TREND_MAX_AGE_DAYS = 30;

/** Reads back what refreshMarketDemandIfStale stored, or null if too old/absent. */
export async function loadMarketTrend(supabase: SupabaseClient): Promise<DemandTrend | null> {
  const { data: settingRow } = await supabase.from("integration_settings").select("value").eq("key", "revenue_engine").maybeSingle();
  const md = (settingRow?.value as { market_demand?: { trend?: string; observed_at?: string } } | undefined)?.market_demand;
  if (!md?.trend || !md.observed_at) return null;
  const ageDays = (Date.now() - Date.parse(md.observed_at)) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays > MARKET_TREND_MAX_AGE_DAYS) return null;
  return md.trend === "naik" || md.trend === "turun" ? md.trend : "stabil";
}

interface MarketSearchIndex {
  /** "2026-10" -> 0..100 */
  byMonth: Map<string, number>;
  baseline: number | null;
  usable: boolean;
}

/**
 * Membaca indeks minat pasar dari settings.
 *
 * Ini yang owner sebut "google analytic" -- dan setelah diperjelas,
 * maksudnya volume PENCARIAN PASAR, bukan analitik situs kita sendiri
 * (tidak ada properti GA4 untuk situs villa). Bedanya penting: angka
 * "orang membuka halaman tapi tidak jadi memesan" tidak bisa dipercaya
 * sebagai ukuran permintaan, karena satu orang bisa membuka puluhan kali
 * dari beberapa perangkat. Volume pencarian seluruh pasar tidak punya
 * masalah itu -- ia mengukur musim, bukan niat satu orang.
 *
 * Baseline = rata-rata seluruh bulan yang diketahui, supaya "ramai"
 * berarti ramai DIBANDING tahun itu sendiri, bukan dibanding angka yang
 * kita karang.
 */
export function readMarketSearchIndex(raw: unknown): MarketSearchIndex {
  const empty: MarketSearchIndex = { byMonth: new Map(), baseline: null, usable: false };
  if (!raw || typeof raw !== "object") return empty;
  const obj = raw as Record<string, unknown>;
  const months = obj.by_month && typeof obj.by_month === "object" ? (obj.by_month as Record<string, unknown>) : null;
  if (!months) return empty;

  const byMonth = new Map<string, number>();
  for (const [k, v] of Object.entries(months)) {
    const n = Number(v);
    if (/^\d{4}-\d{2}$/.test(k) && Number.isFinite(n) && n >= 0 && n <= 100) byMonth.set(k, n);
  }
  if (byMonth.size < 3) return empty;

  const researchedAt = typeof obj.researched_at === "string" ? obj.researched_at : null;
  if (researchedAt) {
    // Indeks basi lebih berbahaya daripada tidak ada indeks: ia
    // menggambarkan musim yang sudah lewat dengan penuh keyakinan.
    const ageDays = (Date.now() - Date.parse(researchedAt)) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > MARKET_SEARCH_STALE_DAYS) return empty;
  }

  const values = [...byMonth.values()];
  const baseline = Number(obj.baseline) > 0 ? Number(obj.baseline) : values.reduce((a, b) => a + b, 0) / values.length;
  return { byMonth, baseline, usable: baseline > 0 };
}

export interface PaceBaseline {
  /** rata-rata unit terjual pada jarak hari itu, dari tanggal-tanggal pembanding */
  byLeadDays: Map<number, number>;
  comparableDates: number;
  usable: boolean;
}

export interface PaceBookingRow {
  unit_id: string;
  tgl_checkin: string;
  tgl_checkout: string | null;
  status: string;
  created_at: string;
}

/**
 * Membangun "pace normal" dari riwayat: pada H-7, H-14, H-30 dan
 * seterusnya, biasanya sudah berapa unit terjual untuk sebuah tanggal?
 *
 * Tanggal pembandingnya hanya tanggal menginap yang SUDAH lewat, jadi pola
 * penumpukannya sudah selesai dan tidak akan berubah lagi.
 */
export function buildPaceBaseline(bookings: PaceBookingRow[], unitIds: Set<string>, today: string, weekend: boolean): PaceBaseline {
  const relevant = bookings.filter((b) => unitIds.has(b.unit_id) && (b.status === "terjadwal" || b.status === "checkin" || b.status === "checkout"));

  const stayDates = new Set<string>();
  for (const b of relevant) {
    const end = b.tgl_checkout ?? b.tgl_checkin;
    for (let d = new Date(`${b.tgl_checkin}T00:00:00Z`); d < new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (iso < today && isWeekendJakarta(iso) === weekend) stayDates.add(iso);
    }
  }

  const byLeadDays = new Map<number, number>();
  if (stayDates.size >= PACE_MIN_COMPARABLE_DATES && relevant.length >= PACE_MIN_HISTORY_BOOKINGS) {
    for (const lead of PACE_LEAD_BUCKETS) {
      let total = 0;
      for (const stayDate of stayDates) {
        const cutoff = new Date(new Date(`${stayDate}T00:00:00Z`).getTime() - lead * 86400000).toISOString();
        total += relevant.filter((b) => b.created_at <= cutoff && b.tgl_checkin <= stayDate && (!b.tgl_checkout || b.tgl_checkout > stayDate)).length;
      }
      byLeadDays.set(lead, total / stayDates.size);
    }
  }

  return { byLeadDays, comparableDates: stayDates.size, usable: byLeadDays.size > 0 };
}

/** Jarak-hari pembanding terdekat untuk sebuah tanggal target. */
export function nearestLeadBucket(daysToArrival: number): number | null {
  const eligible = PACE_LEAD_BUCKETS.filter((b) => b >= daysToArrival);
  return eligible.length ? Math.min(...eligible) : null;
}

interface DemandSignal {
  code: string;
  /** penyesuaian yang diusulkan sinyal ini, dalam pecahan (0.05 = +5%) */
  pct: number;
  weight: number;
}

/**
 * Menggabungkan sinyal yang TERSEDIA saja, lalu menormalkan bobotnya.
 *
 * Kalau hanya okupansi yang punya data, hasilnya sama persis dengan mesin
 * sebelum lapisan ini ada -- itu disengaja, supaya penambahan ini tidak
 * mengubah harga apa pun sampai sinyal barunya benar-benar punya bahan.
 */
function combineDemandSignals(signals: DemandSignal[]): { pct: number; codes: string[] } {
  const usable = signals.filter((s) => s.weight > 0);
  if (!usable.length) return { pct: 0, codes: [] };
  const totalWeight = usable.reduce((a, s) => a + s.weight, 0);
  const pct = usable.reduce((a, s) => a + s.pct * s.weight, 0) / totalWeight;
  return { pct, codes: usable.filter((s) => s.pct !== 0).map((s) => s.code) };
}

export interface SeasonPeriod {
  suggested_adjustment_pct: number;
  created_by: string | null;
}

export interface DateDecisionInput {
  targetDate: string;
  anchorRate: number;
  occupancyPct: number;
  /** Nights between the run date and the stay date. 0 = tonight. */
  daysToArrival: number;
  coldStart: boolean;
  /** The strongest period covering this date, or null. See pickPeriodForDate. */
  period: SeasonPeriod | null;
  competitorMedian: number | null;
  /** What this date sells at right now (villa_rates), or null if unpriced. */
  liveRate: number | null;
  /**
   * SINYAL 2 (cadangan): bacaan kualitatif naik/turun/stabil. Hanya
   * dipakai kalau `marketSearchRelative` tidak ada -- lihat
   * MARKET_SEARCH_SETTINGS_KEY untuk kenapa tidak pernah keduanya.
   */
  marketTrend: DemandTrend | null;
  /**
   * SINYAL 2 (utama): simpangan relatif minat pencarian bulan ini terhadap
   * baseline tahun itu, mis. +0,3 berarti 30% di atas rata-rata bulan lain.
   * null = indeksnya tidak tersedia atau sudah basi.
   */
  marketSearchRelative: number | null;
  /** SINYAL 4: unit yang biasanya sudah terjual pada jarak hari ini. null = pace belum bisa dinilai. */
  paceExpectedSold: number | null;
  /** SINYAL 4: unit yang nyatanya sudah terjual untuk tanggal ini. */
  unitsSoldNow: number;
  settings: PricingSettings;
  minRate: number | null;
  maxRate: number | null;
}

/**
 * The whole price decision for ONE date, as a pure function.
 *
 * Extracted from decideRatesForRoomType on 2026-09-12 so the reasoning
 * can be tested directly (src/lib/aiPricingEngine.test.ts) instead of
 * only against live Supabase data. Every regression this file documents
 * -- the compounding anchor, the event that jumped 16/22/23 Sep to the
 * ceiling, the thin competitor sample that cut a real Saturday -- was
 * found in production, on real OTA-visible prices, because there was no
 * way to ask "what would this rule do?" without running it for real.
 *
 * The order below is the order a revenue manager reasons in, and the
 * order matters: each step may only adjust the number the step before it
 * produced.
 *
 *   1. anchor            -- base_rate, a value this engine never writes
 *   2. weekend           -- a known, permanent pattern
 *   3. pickup            -- demand actually realised for THIS date,
 *                           weighted by how close arrival is (lead time)
 *   4. season period     -- a peak must be EARNED by pickup; a trough is
 *                           applied straight away but withdrawn if the
 *                           date is selling anyway
 *   5. market interest   -- a small nudge from search/booking interest
 *   6. competitor median -- a sanity CAP, never a floor
 *   7. near-arrival      -- an empty date close in is never priced UP
 *   8. movement clamp    -- vs. what the date sells at TODAY
 *   9. min_rate/max_rate -- the owner's hard guardrails, always last
 *
 * Steps 4-8 came from the 2026-09-12 incident: an event used to put the
 * date into "high season", where the competitor average acted as a FLOOR
 * and bypassed the movement clamp entirely, which pushed 16/22/23 Sep
 * from Rp650,000 to the Rp1,000,000 ceiling in a single run, live on
 * every OTA, on dates with zero bookings. The rule that replaced it: an
 * event is a reason to EXPECT demand, only pickup is a reason to charge
 * for it.
 *
 * Steps 3 (lead time), 4 (troughs) and 5 (market interest) are the
 * 2026-09-12 reasoning expansion -- see SIGNAL 1/2/3 at the top of this
 * file for why each exists and why each is bounded where it is.
 *
 * `anchorRate` MUST be villa_room_types.base_rate, a value this engine
 * never writes to. Passing units.tarif_harian, as the first version did,
 * made every run compound on the previous run's output and ratchet the
 * price toward max_rate on Fri/Sat regardless of occupancy (see
 * 20260911000001_pricing_base_rate_and_autopush.sql). With a fixed
 * anchor this function is idempotent: same inputs, same price, however
 * many times it runs in a day.
 */
export function decideRateForDate(input: DateDecisionInput): DatePriceDecision {
  const { targetDate, anchorRate, occupancyPct, daysToArrival, coldStart, period, competitorMedian, liveRate, marketTrend, marketSearchRelative, paceExpectedSold, unitsSoldNow, settings, minRate, maxRate } = input;

  const reasonCodes: string[] = [];
  let guardrailStatus: DatePriceDecision["guardrail_status"] = "within_range";

  // --- 1. Start from the stable anchor, never from the last price ---
  let decidedRate = anchorRate;

  // --- 2. Day-of-week seasonality (a known, permanent pattern) ---
  if (isWeekendJakarta(targetDate)) {
    decidedRate += WEEKEND_SURCHARGE;
    reasonCodes.push("weekend");
  }

  // The owner's own rate plan: base rate plus the weekend pattern, before
  // any demand, event or market adjustment. The competitor cap below is
  // not allowed to price UNDER this on research alone.
  const structuralRate = decidedRate;

  // --- 3. Permintaan, dibaca dari BEBERAPA sinyal sekaligus ---
  //
  // Sampai 2026-09-12 permintaan diukur dari SATU hal: berapa persen unit
  // terisi pada tanggal itu. Sekarang tiga, digabung berbobot, dan yang
  // tidak punya data tidak ikut sama sekali (lihat SIGNAL_WEIGHTS).
  // Kalau hanya okupansi yang tersedia, hasilnya identik dengan mesin
  // sebelum lapisan ini ada.
  const signals: DemandSignal[] = [];

  // S1 · okupansi terealisasi, ditimbang lead time.
  let occupancySignalPct = 0;
  if (occupancyPct >= settings.high_occupancy_threshold_pct) {
    // Filling up is the strongest signal there is, at any lead time.
    occupancySignalPct = settings.high_occupancy_adjustment_pct;
    reasonCodes.push("high_occupancy");
  } else if (occupancyPct <= settings.low_occupancy_threshold_pct) {
    if (coldStart) {
      reasonCodes.push("cold_start_hold");
    } else {
      // An empty date far out is not a distress signal -- see SIGNAL 3.
      const leadShare = daysToArrival <= DISCOUNT_LEAD_TIME_FULL_DAYS ? 1 : daysToArrival <= DISCOUNT_LEAD_TIME_HALF_DAYS ? 0.5 : 0;
      if (leadShare === 0) {
        reasonCodes.push("low_occupancy_too_early_to_discount");
      } else {
        occupancySignalPct = settings.low_occupancy_adjustment_pct * leadShare;
        reasonCodes.push(leadShare === 1 ? "low_occupancy" : "low_occupancy_partial_lead_time");
      }
    }
  }
  signals.push({ code: "occupancy", pct: occupancySignalPct, weight: SIGNAL_WEIGHTS.occupancy });

  // S4 · pace: menumpuk lebih cepat/lambat dari tanggal pembanding pada
  // jarak hari yang sama. Sinyal paling dini yang kita punya -- ia bergerak
  // jauh sebelum okupansi terlihat tinggi. Ditahan saat cold start, sama
  // seperti event uplift: menilai "lebih cepat dari biasanya" ketika
  // "biasanya" belum ada artinya hanyalah menebak.
  if (paceExpectedSold !== null && paceExpectedSold > 0) {
    if (coldStart) {
      reasonCodes.push("pace_held_cold_start");
    } else {
      const ratio = (unitsSoldNow - paceExpectedSold) / paceExpectedSold;
      if (Math.abs(ratio) >= PACE_SIGNIFICANT_RATIO) {
        const pacePct = Math.max(-PACE_MAX_ADJUSTMENT_PCT, Math.min(PACE_MAX_ADJUSTMENT_PCT, ratio * PACE_MAX_ADJUSTMENT_PCT));
        signals.push({ code: ratio > 0 ? "pace_ahead" : "pace_behind", pct: pacePct, weight: SIGNAL_WEIGHTS.pace });
      }
    }
  }

  // S2 · minat pasar. Indeks berangka per bulan lebih dulu; bacaan
  // kualitatif naik/turun hanya menggantikannya kalau indeksnya tidak ada,
  // supaya sinyal yang sama tidak dihitung dua kali.
  //
  // Ikut ditahan cold start. Tanpa penahanan ini, villa yang belum punya
  // riwayat penjualan sama sekali tetap menaikkan harga hanya karena
  // seluruh Jogja sedang ramai dicari -- justru di saat itulah kita paling
  // tidak punya bukti bahwa keramaian pasar akan sampai ke kita.
  const hasMarketSignal = marketSearchRelative !== null || marketTrend !== null;
  if (hasMarketSignal && coldStart) {
    reasonCodes.push("market_search_held_cold_start");
  } else if (marketSearchRelative !== null) {
    const searchPct = Math.max(-MARKET_SEARCH_MAX_ADJUSTMENT_PCT, Math.min(MARKET_SEARCH_MAX_ADJUSTMENT_PCT, marketSearchRelative * MARKET_SEARCH_MAX_ADJUSTMENT_PCT));
    if (searchPct !== 0) signals.push({ code: searchPct > 0 ? "market_search_high" : "market_search_low", pct: searchPct, weight: SIGNAL_WEIGHTS.market_search });
  } else if (marketTrend === "naik" || marketTrend === "turun") {
    const trendPct = marketTrend === "naik" ? MARKET_TREND_ADJUSTMENT_PCT : -MARKET_TREND_ADJUSTMENT_PCT;
    signals.push({ code: marketTrend === "naik" ? "market_interest_up" : "market_interest_down", pct: trendPct, weight: SIGNAL_WEIGHTS.market_search });
  }

  const combined = combineDemandSignals(signals);
  for (const code of combined.codes) if (!reasonCodes.includes(code)) reasonCodes.push(code);
  decidedRate = Math.round(decidedRate * (1 + combined.pct));

  // --- 4. Season period: a peak is earned, a trough is offered ---
  const periodPct = period ? Number(period.suggested_adjustment_pct) || 0 : 0;
  const isPeakPeriod = period !== null && periodPct > 0;
  if (period && periodPct < 0) {
    // A trough (Ramadan, the quiet weeks after the school holidays).
    // Applied without waiting for pickup -- a discount exists precisely
    // to attract demand that has not arrived -- but withdrawn if this
    // date turns out not to need it.
    reasonCodes.push("low_season");
    if (occupancyPct >= LOW_SEASON_SUPPRESS_OCC_PCT) {
      reasonCodes.push("low_season_discount_not_needed");
    } else {
      decidedRate = Math.round(decidedRate * (1 + periodPct));
      reasonCodes.push("low_season_discount");
    }
  } else if (isPeakPeriod) {
    reasonCodes.push("high_season");
    let earnedShare = 0;
    if (appliesWithoutPickup(period.created_by)) {
      // An owner-entered period, or a certain yearly peak like New Year
      // or Lebaran. Both are priced ahead of time on purpose and are not
      // subject to the pickup test -- guests book these months out, so
      // waiting for pickup means selling the peak at base rate.
      earnedShare = 1;
      reasonCodes.push(period.created_by === MARKET_DEMAND_RECURRING_CREATED_BY ? "recurring_peak" : "owner_high_season");
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
    if (earnedShare > 0) decidedRate = Math.round(decidedRate * (1 + periodPct * earnedShare));
  }

  // --- 6. Competitor band: a sanity CAP, never a floor ---
  //
  // The cap restrains OUR optimism -- it trims an uplift we added on top
  // of the rate plan. It is not allowed to undercut the rate plan itself:
  // on 2026-09-11 a thin competitor sample cut a real Saturday price, and
  // the median alone does not prevent that (the three Sawah View
  // comparables median to Rp809,281, below our own Rp850,000 Saturday).
  // Hence max() against structuralRate.
  //
  // And it does not apply on a certain peak at all. villa_competitor_
  // rates holds an ORDINARY nightly price: the research prompt asks for
  // "harga per malam publik" with no stay date, so the sample describes a
  // normal night, not New Year. Capping a New Year price with it compares
  // two different things -- and did: Sawah View's whole Christmas/New
  // Year period came out at Rp809,281, with Fri/Sat getting no uplift
  // whatsoever because the cap landed exactly on the ordinary weekend
  // price. Everybody raises rates over New Year, so an off-peak
  // observation is not evidence about that date.
  //
  // A TROUGH is the opposite case and keeps the cap: pricing below the
  // neighbours during Ramadan is the entire intent, and the cap only ever
  // pushes down.
  const competitorCapApplies = competitorMedian !== null && !(isPeakPeriod && appliesWithoutPickup(period.created_by));
  if (competitorCapApplies && competitorMedian !== null) {
    const cap = Math.max(Math.round(competitorMedian), structuralRate);
    if (decidedRate > cap) {
      decidedRate = cap;
      reasonCodes.push("competitor_market_cap");
    }
  }

  // --- 7. Close to arrival and still empty: never price up ---
  if (liveRate !== null && daysToArrival <= NEAR_ARRIVAL_DAYS && occupancyPct < NEAR_ARRIVAL_MIN_OCC_PCT && decidedRate > liveRate) {
    decidedRate = liveRate;
    reasonCodes.push("near_arrival_no_increase");
  }

  // --- 8. Movement clamp against what the date sells at TODAY ---
  //
  // The clamp exists so price never LURCHES -- "jangan dinaikkan
  // drastis". It deliberately does not apply to a move that lands between
  // today's live price and the anchor, because that is a correction back
  // toward the owner's own base rate, not a swing away from it. Without
  // this exception the clamp would actively slow down undoing a bad
  // price: recovering 16 Sep from the Rp1,000,000 ceiling to Rp650,000
  // would have taken three days of -15% steps, with the wrong price live
  // on every OTA the whole time.
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

  // --- 9. Owner's hard guardrails always win, last ---
  //
  // This is the line the owner pointed at when allowing the AI to set
  // prices itself ("saya memang membuat batas bawah harga normal"):
  // whatever the model researched and whatever the rules above concluded,
  // no guest ever sees a price below min_rate or above max_rate.
  if (minRate !== null && decidedRate < minRate) {
    decidedRate = minRate;
    guardrailStatus = "clamped_min";
  }
  if (maxRate !== null && decidedRate > maxRate) {
    decidedRate = maxRate;
    guardrailStatus = "clamped_max";
  }

  return {
    date: targetDate,
    anchor_rate: anchorRate,
    decided_rate: decidedRate,
    reason_codes: reasonCodes,
    guardrail_status: guardrailStatus,
    occupancy_pct: occupancyPct,
    reason_text: narrateDecision(reasonCodes, guardrailStatus, occupancyPct, daysToArrival),
  };
}

/**
 * One plain-Indonesian sentence per date explaining WHY that price.
 *
 * reason_codes are precise but unreadable to the person who actually
 * carries the consequence of a wrong price. This is written from the
 * codes the rules above already emitted -- never by a language model, so
 * the explanation can never drift from the arithmetic it describes.
 */
function narrateDecision(codes: string[], guardrail: DatePriceDecision["guardrail_status"], occupancyPct: number, daysToArrival: number): string {
  const has = (c: string) => codes.includes(c);
  const parts: string[] = [];

  parts.push(has("weekend") ? "Harga dasar akhir pekan" : "Harga dasar");

  if (has("high_occupancy")) parts.push(`dinaikkan karena tanggal ini sudah terisi ${occupancyPct}%`);
  else if (has("cold_start_hold")) parts.push("diskon okupansi ditahan dulu karena riwayat pemesanan belum cukup");
  else if (has("low_occupancy_too_early_to_discount")) parts.push(`belum diturunkan walau masih kosong — masih ${daysToArrival} hari lagi, terlalu dini`);
  else if (has("low_occupancy_partial_lead_time")) parts.push(`didiskon separuh karena masih kosong dan tinggal ${daysToArrival} hari lagi`);
  else if (has("low_occupancy")) parts.push(`didiskon penuh karena masih kosong dan tinggal ${daysToArrival} hari lagi`);

  if (has("low_season_discount")) parts.push("diturunkan lagi karena masuk periode sepi");
  else if (has("low_season_discount_not_needed")) parts.push("masuk periode sepi tapi tanggal ini sudah laku, jadi tidak didiskon");
  else if (has("recurring_peak")) parts.push("dinaikkan penuh karena puncak musiman tahunan yang sudah pasti");
  else if (has("owner_high_season")) parts.push("dinaikkan penuh karena periode high season yang diatur pemilik");
  else if (has("event_demand_confirmed")) parts.push("dinaikkan penuh karena ada event dan permintaannya sudah terbukti");
  else if (has("event_demand_building")) parts.push("dinaikkan separuh karena ada event dan permintaannya mulai terlihat");
  else if (has("event_demand_unproven")) parts.push("ada event, tapi belum dinaikkan karena belum ada yang memesan");
  else if (has("event_uplift_held_cold_start")) parts.push("ada event, tapi kenaikan ditahan karena data pemesanan belum cukup");

  if (has("pace_ahead")) parts.push("terbantu karena tanggal ini terisi lebih cepat dari biasanya");
  else if (has("pace_behind")) parts.push("tertahan karena tanggal ini terisi lebih lambat dari biasanya");

  if (has("market_search_high")) parts.push("sedikit dinaikkan karena bulan ini termasuk ramai dicari");
  else if (has("market_search_low")) parts.push("sedikit diturunkan karena bulan ini termasuk sepi dicari");
  else if (has("market_interest_up")) parts.push("sedikit dinaikkan karena minat pencarian villa sedang naik");
  else if (has("market_interest_down")) parts.push("sedikit diturunkan karena minat pencarian villa sedang turun");

  if (has("competitor_market_cap")) parts.push("lalu dibatasi agar tidak melewati harga tengah villa sekitar");
  if (has("near_arrival_no_increase")) parts.push("dan tidak dinaikkan karena sudah dekat tanggal menginap tapi masih kosong");

  if (guardrail === "clamped_movement") parts.push("terakhir direm agar tidak berubah drastis dari harga hari ini");
  else if (guardrail === "clamped_min") parts.push("terakhir dinaikkan ke batas bawah harga yang pemilik tetapkan");
  else if (guardrail === "clamped_max") parts.push("terakhir diturunkan ke batas atas harga yang pemilik tetapkan");

  return `${parts.join(", ")}.`;
}

/**
 * Which period governs a date when several overlap.
 *
 * The strongest adjustment wins, so a peak always beats a trough that
 * overlaps it -- Idul Fitri sits days after Ramadan ends and the two
 * ranges can touch, and a date that is both must be priced as the peak,
 * never as the trough.
 */
function pickPeriodForDate(periods: SeasonPeriod[]): SeasonPeriod | null {
  if (periods.length === 0) return null;
  return periods.reduce((best, p) => (Number(p.suggested_adjustment_pct) > Number(best.suggested_adjustment_pct) ? p : best));
}

/**
 * Loads everything decideRateForDate needs from Supabase and runs it
 * across a set of dates for one room type. All the reasoning lives in
 * decideRateForDate above; this function only gathers inputs.
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
    .select("unit_id, tgl_checkin, tgl_checkout, status, created_at")
    .neq("status", "batal");
  const { data: units } = await supabase.from("units").select("id").eq("room_type_id", roomType.id);
  const unitIds = new Set((units ?? []).map((u) => u.id));

  const today = targetDates[0] ?? new Date().toISOString().slice(0, 10);
  const toDate = targetDates[targetDates.length - 1] ?? today;
  const { data: seasonPeriods } = await supabase
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
  // Owner correction (2026-09-12): and only when there are enough of them
  // to be a market rather than an anecdote, using the median so one
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
  // not against the anchor -- the 16/22/23 Sep incident moved price +54%
  // in one run precisely because the event and competitor branches wrote
  // an absolute number that never passed through the movement clamp.
  const { data: liveRates } = await supabase
    .from("villa_rates")
    .select("date, rate")
    .eq("room_type_id", roomType.id)
    .gte("date", today)
    .lte("date", toDate);
  const liveRateByDate = new Map((liveRates ?? []).map((r) => [String(r.date), Number(r.rate)]));

  const marketTrend = await loadMarketTrend(supabase);
  const { data: searchSetting } = await supabase.from("integration_settings").select("value").eq("key", MARKET_SEARCH_SETTINGS_KEY).maybeSingle();
  const marketSearch = readMarketSearchIndex(searchSetting?.value);

  // Pace disiapkan sekali di luar loop tanggal: baseline-nya sama untuk
  // seluruh jendela, hanya dipisah weekend/bukan-weekend.
  const bookingRows = (allBookings ?? []) as PaceBookingRow[];
  const paceWeekend = buildPaceBaseline(bookingRows, unitIds, today, true);
  const paceWeekday = buildPaceBaseline(bookingRows, unitIds, today, false);

  const coldStart = (allBookings ?? []).length < COLD_START_MIN_BOOKINGS;
  const minRate = roomType.min_rate !== null ? Number(roomType.min_rate) : null;
  const maxRate = roomType.max_rate !== null ? Number(roomType.max_rate) : null;

  return targetDates.map((targetDate) => {
    const activeForDate = (allBookings ?? []).filter(
      (b) =>
        unitIds.has(b.unit_id) &&
        (b.status === "terjadwal" || b.status === "checkin") &&
        b.tgl_checkin <= targetDate &&
        (!b.tgl_checkout || b.tgl_checkout > targetDate),
    );
    const occupancyPct = unitIds.size > 0 ? Math.round((activeForDate.length / unitIds.size) * 1000) / 10 : 0;
    const covering = (seasonPeriods ?? []).filter((p) => p.start_date <= targetDate && p.end_date >= targetDate);

    const daysToArrival = daysBetween(today, targetDate);
    const paceBaseline = isWeekendJakarta(targetDate) ? paceWeekend : paceWeekday;
    const leadBucket = nearestLeadBucket(daysToArrival);
    const paceExpectedSold = paceBaseline.usable && leadBucket !== null ? paceBaseline.byLeadDays.get(leadBucket) ?? null : null;

    const monthIndex = marketSearch.usable ? marketSearch.byMonth.get(targetDate.slice(0, 7)) : undefined;
    const marketSearchRelative = monthIndex !== undefined && marketSearch.baseline ? (monthIndex - marketSearch.baseline) / marketSearch.baseline : null;

    return decideRateForDate({
      targetDate,
      anchorRate,
      occupancyPct,
      daysToArrival,
      coldStart,
      period: pickPeriodForDate(covering as SeasonPeriod[]),
      competitorMedian,
      liveRate: liveRateByDate.get(targetDate) ?? null,
      marketTrend,
      marketSearchRelative,
      paceExpectedSold,
      unitsSoldNow: activeForDate.length,
      settings,
      minRate,
      maxRate,
    });
  });
}
