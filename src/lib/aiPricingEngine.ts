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
 * ── Lapisan sinyal permintaan (permintaan owner 2026-09-12) ────────────
 *
 * Owner: "pendekatan kt brrti bisa berdasarkan beberapa pendekatan sampai
 * akhirnya ai mngambil keputusan trkait harga ... agar bisa mengambil
 * keputusan yg betul2 tepat dari berbagi sumber".
 *
 * Sebelum ini hanya ADA SATU sinyal permintaan: okupansi tanggal itu.
 * Sekarang tiga, dan masing-masing HANYA ikut bicara kalau datanya cukup:
 *
 *   S1 okupansi   — sudah terisi berapa persen. Selalu tersedia.
 *   S2 pace       — menumpuknya lebih cepat atau lebih lambat dari tanggal
 *                   pembanding pada jarak hari yang sama. Butuh riwayat.
 *   S3 minat pasar— berapa ramai orang mencari villa di Jogja bulan itu.
 *                   Butuh indeks hasil riset.
 *
 * Aturan yang membuat lapisan ini tidak berbahaya:
 *
 * 1. Sinyal tanpa data TIDAK dianggap netral lalu ikut menarik rata-rata
 *    ke nol — ia tidak ikut sama sekali, dan bobot sisanya dinormalkan.
 *    Menganggap "tidak tahu" sebagai "biasa saja" adalah cara paling halus
 *    untuk membuat sistem percaya diri pada data yang tidak ada.
 * 2. Batas geraknya kecil dan terpisah dari okupansi, jadi kalaupun dua
 *    sinyal baru ini salah arah bersamaan, pengaruhnya terbatas.
 * 3. Semuanya tetap lewat plafon kompetitor, penjaga dekat-kedatangan,
 *    klem pergerakan, dan lantai/plafon owner -- tidak ada satu pun yang
 *    dilewati.
 * 4. Cold start menahan keduanya, sama seperti event uplift.
 */

/** Pace butuh pembanding. Di bawah ini, "lebih cepat dari biasanya" tidak punya arti. */
const PACE_MIN_COMPARABLE_DATES = 6;
const PACE_MIN_HISTORY_BOOKINGS = 15;
/** Jendela hari-sebelum-menginap yang dipakai membandingkan pace. */
const PACE_LEAD_BUCKETS = [7, 14, 30, 60, 90];
/** Sejauh mana pace boleh menggerakkan harga, sebelum digabung. */
const PACE_MAX_ADJUSTMENT_PCT = 0.08;
/** Selisih pace yang dianggap berarti (bukan derau satu-dua booking). */
const PACE_SIGNIFICANT_RATIO = 0.25;

/**
 * Indeks minat pasar per bulan, 0-100, disimpan di
 * integration_settings.villa_market_search_index sebagai
 * { "2026-10": 62, "2026-11": 58, ... } beserta baseline-nya.
 *
 * Sengaja di settings, bukan tabel baru: isinya cuma belasan angka yang
 * disegarkan berkala, dan menambah tabel untuk itu berarti mengubah skema
 * -- yang di proyek ini butuh izin owner lebih dulu. Kalau nanti perlu
 * riwayat per minggu, barulah pindah ke tabel sendiri.
 */
const MARKET_SEARCH_SETTINGS_KEY = "villa_market_search_index";
/** Sejauh mana minat pasar boleh menggerakkan harga. Paling kecil: ia sinyal paling kasar. */
const MARKET_SEARCH_MAX_ADJUSTMENT_PCT = 0.05;
const MARKET_SEARCH_STALE_DAYS = 45;

/**
 * Bobot penggabungan. Okupansi paling berat karena ia satu-satunya yang
 * mengukur uang yang benar-benar sudah masuk untuk tanggal itu; minat
 * pasar paling ringan karena ia mengukur seluruh Jogja, bukan villa kita.
 */
const SIGNAL_WEIGHTS = { occupancy: 0.6, pace: 0.28, market_search: 0.12 } as const;

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

  // Simpan indeks minat pasar kalau jembatan mengirimkannya. Disimpan di
  // settings, bukan tabel baru -- isinya belasan angka, dan menambah tabel
  // berarti mengubah skema yang butuh izin owner lebih dulu.
  if (result.search_index_by_month) {
    await supabase.from("integration_settings").upsert(
      {
        key: MARKET_SEARCH_SETTINGS_KEY,
        value: { by_month: result.search_index_by_month, researched_at: new Date().toISOString(), source: "ai_market_demand_research" },
      },
      { onConflict: "key" },
    );
  }

  return { refreshed: true, demand_trend: result.demand_trend, trend_note: result.trend_note, events_upserted: upserted, search_index_months: result.search_index_by_month ? Object.keys(result.search_index_by_month).length : 0 };
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
interface MarketSearchIndex {
  /** "2026-10" -> 0..100 */
  byMonth: Map<string, number>;
  baseline: number | null;
  researchedAt: string | null;
  usable: boolean;
}

/**
 * Indeks minat pasar: seberapa ramai orang mencari villa di Jogja per bulan.
 *
 * Ini yang diminta owner dengan sebutan "google analytic" -- dan setelah
 * diperjelas, maksudnya volume PENCARIAN PASAR, bukan analitik situs kita
 * sendiri. Bedanya penting: data "orang membuka halaman tapi tidak jadi
 * memesan" (regrets/denials) dikenal tidak bisa dipercaya sebagai angka
 * permintaan karena satu orang bisa membuka puluhan kali dari beberapa
 * perangkat. Volume pencarian seluruh pasar tidak punya masalah itu; ia
 * mengukur musim, bukan niat satu orang.
 *
 * Karena itu bobotnya paling kecil dan batas geraknya paling sempit: ia
 * memberi tahu bulan mana Jogja ramai, bukan apakah VILLA KITA akan penuh.
 */
function readMarketSearchIndex(raw: unknown): MarketSearchIndex {
  const empty: MarketSearchIndex = { byMonth: new Map(), baseline: null, researchedAt: null, usable: false };
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
    const ageDays = (Date.now() - Date.parse(researchedAt)) / 86400000;
    // Indeks basi lebih berbahaya daripada tidak ada indeks: ia menggambarkan
    // musim yang sudah lewat dengan penuh keyakinan.
    if (Number.isFinite(ageDays) && ageDays > MARKET_SEARCH_STALE_DAYS) return empty;
  }

  // Baseline = rata-rata seluruh bulan yang diketahui, supaya "ramai" berarti
  // ramai DIBANDING tahun itu sendiri, bukan dibanding angka yang kita karang.
  const values = [...byMonth.values()];
  const baseline = Number(obj.baseline) > 0 ? Number(obj.baseline) : values.reduce((a, b) => a + b, 0) / values.length;

  return { byMonth, baseline, researchedAt, usable: baseline > 0 };
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

interface PaceBaseline {
  /** rata-rata unit terjual pada jarak hari itu, dari tanggal-tanggal pembanding */
  byLeadDays: Map<number, number>;
  comparableDates: number;
  usable: boolean;
}

/**
 * Membangun "pace normal" dari riwayat: pada H-7, H-14, H-30 dan seterusnya,
 * biasanya sudah berapa unit terjual untuk sebuah tanggal?
 *
 * Dihitung dari bookings.created_at, BUKAN dari snapshot harian. Snapshot
 * (villa_daily_inventory_snapshot) hanya merekam keadaan hari itu, jadi ia
 * tidak bisa menjawab "20 Oktober sudah seramai apa saat kita masih 30 hari
 * sebelumnya". created_at bisa menjawabnya secara surut, tanpa menunggu
 * berbulan-bulan mengumpulkan snapshot baru.
 *
 * Dipisah per weekend/bukan-weekend: membandingkan Sabtu dengan Selasa akan
 * membuat setiap Sabtu terlihat "lebih cepat dari biasanya" selamanya.
 */
function buildPaceBaseline(
  bookings: { unit_id: string; tgl_checkin: string; tgl_checkout: string | null; status: string; created_at: string }[],
  unitIds: Set<string>,
  today: string,
  weekend: boolean,
): PaceBaseline {
  const relevant = bookings.filter(
    (b) => unitIds.has(b.unit_id) && (b.status === "terjadwal" || b.status === "checkin" || b.status === "checkout"),
  );

  // Tanggal pembanding: tanggal menginap yang SUDAH lewat, jadi pola
  // penumpukannya sudah selesai dan tidak akan berubah lagi.
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
        total += relevant.filter(
          (b) =>
            b.created_at <= cutoff &&
            b.tgl_checkin <= stayDate &&
            (!b.tgl_checkout || b.tgl_checkout > stayDate),
        ).length;
      }
      byLeadDays.set(lead, total / stayDates.size);
    }
  }

  return { byLeadDays, comparableDates: stayDates.size, usable: byLeadDays.size > 0 };
}

/** Jarak-hari pembanding terdekat untuk sebuah tanggal target. */
function nearestLeadBucket(daysToArrival: number): number | null {
  const eligible = PACE_LEAD_BUCKETS.filter((b) => b >= daysToArrival);
  return eligible.length ? Math.min(...eligible) : null;
}

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

  // Sinyal permintaan tambahan, disiapkan sekali di luar loop tanggal.
  const bookingRows = (allBookings ?? []) as {
    unit_id: string; tgl_checkin: string; tgl_checkout: string | null; status: string; created_at: string;
  }[];
  const paceWeekend = buildPaceBaseline(bookingRows, unitIds, today, true);
  const paceWeekday = buildPaceBaseline(bookingRows, unitIds, today, false);

  const { data: searchSetting } = await supabase
    .from("integration_settings")
    .select("value")
    .eq("key", MARKET_SEARCH_SETTINGS_KEY)
    .maybeSingle();
  const marketSearch = readMarketSearchIndex(searchSetting?.value);

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

    // --- 3. Permintaan, dibaca dari BEBERAPA sinyal sekaligus ---
    //
    // Owner 2026-09-12: "pendekatan kt brrti bisa berdasarkan beberapa
    // pendekatan sampai akhirnya ai mngambil keputusan trkait harga".
    //
    // Tiga sinyal, digabung berbobot, dan yang tidak punya data tidak ikut
    // sama sekali. Kalau hanya okupansi yang tersedia -- keadaan hari ini --
    // hasilnya identik dengan mesin sebelum lapisan ini ada.
    const signals: DemandSignal[] = [];

    // S1 · okupansi terealisasi: satu-satunya sinyal yang mengukur uang
    // yang benar-benar sudah masuk untuk tanggal ini.
    let occupancySignalPct = 0;
    if (occupancyPct >= settings.high_occupancy_threshold_pct) {
      occupancySignalPct = settings.high_occupancy_adjustment_pct;
      reasonCodes.push("high_occupancy");
    } else if (occupancyPct <= settings.low_occupancy_threshold_pct) {
      if (coldStart) {
        reasonCodes.push("cold_start_hold");
      } else {
        occupancySignalPct = settings.low_occupancy_adjustment_pct;
        reasonCodes.push("low_occupancy");
      }
    }
    signals.push({ code: "occupancy", pct: occupancySignalPct, weight: SIGNAL_WEIGHTS.occupancy });

    const daysToArrivalForPace = daysBetween(today, targetDate);

    // S2 · pace: menumpuk lebih cepat atau lebih lambat dari tanggal
    // pembanding pada jarak hari yang sama. Ini sinyal paling dini yang
    // kita punya -- ia bergerak jauh sebelum okupansi terlihat tinggi.
    const paceBaseline = isWeekendJakarta(targetDate) ? paceWeekend : paceWeekday;
    const leadBucket = nearestLeadBucket(daysToArrivalForPace);
    const expectedSold = leadBucket !== null ? paceBaseline.byLeadDays.get(leadBucket) ?? null : null;

    if (coldStart) {
      // Ditahan sama seperti event uplift: menilai "lebih cepat dari
      // biasanya" saat "biasanya" belum ada artinya adalah menebak.
      if (paceBaseline.usable) reasonCodes.push("pace_held_cold_start");
    } else if (paceBaseline.usable && expectedSold !== null && expectedSold > 0) {
      const actualSold = activeForDate.length;
      const ratio = (actualSold - expectedSold) / expectedSold;
      if (Math.abs(ratio) >= PACE_SIGNIFICANT_RATIO) {
        const pacePct = Math.max(-PACE_MAX_ADJUSTMENT_PCT, Math.min(PACE_MAX_ADJUSTMENT_PCT, ratio * PACE_MAX_ADJUSTMENT_PCT));
        signals.push({ code: ratio > 0 ? "pace_ahead" : "pace_behind", pct: pacePct, weight: SIGNAL_WEIGHTS.pace });
      }
    }

    // S3 · minat pasar: bulan ini seramai apa orang mencari villa di Jogja,
    // dibanding rata-rata bulan lain. Mengukur musim pasar, bukan villa kita
    // -- itu sebabnya bobot dan batas geraknya paling kecil.
    //
    // Ikut ditahan cold start. Ini ketahuan lewat simulasi, bukan lewat
    // membaca kode: tanpa penahanan ini, villa yang belum punya riwayat
    // penjualan sama sekali tetap menaikkan harga hanya karena seluruh
    // Jogja sedang ramai dicari. Justru di saat itulah kita paling tidak
    // punya bukti bahwa keramaian pasar akan sampai ke kita.
    if (coldStart) {
      if (marketSearch.usable) reasonCodes.push("market_search_held_cold_start");
    } else if (marketSearch.usable && marketSearch.baseline) {
      const monthKey = targetDate.slice(0, 7);
      const monthIndex = marketSearch.byMonth.get(monthKey);
      if (monthIndex !== undefined) {
        const relative = (monthIndex - marketSearch.baseline) / marketSearch.baseline;
        const searchPct = Math.max(
          -MARKET_SEARCH_MAX_ADJUSTMENT_PCT,
          Math.min(MARKET_SEARCH_MAX_ADJUSTMENT_PCT, relative * MARKET_SEARCH_MAX_ADJUSTMENT_PCT),
        );
        if (searchPct !== 0) {
          signals.push({
            code: searchPct > 0 ? "market_search_high" : "market_search_low",
            pct: searchPct,
            weight: SIGNAL_WEIGHTS.market_search,
          });
        }
      }
    }

    const combined = combineDemandSignals(signals);
    for (const code of combined.codes) if (!reasonCodes.includes(code)) reasonCodes.push(code);
    decidedRate = Math.round(decidedRate * (1 + combined.pct));

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
