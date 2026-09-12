import "server-only";

import { supabaseAdmin } from "./supabaseAdmin";

/**
 * Villa has no Gemini integration or GEMINI_API_KEY of its own. Instead, the
 * AI CCTV checkpoint module calls into Mkhsistem's existing AI Service via a
 * dedicated bridge endpoint (loonarsliving/Mkhsistem's
 * app/api/villa/ai/cctv-vision), reusing the SAME shared secret already
 * configured for the WhatsApp bridge (integration_settings.vercel_bridge --
 * villa-api's sendWa() reads it the same way) rather than a second,
 * separately-managed AI credential.
 */

export interface CctvDetectionResult {
  person_present: boolean;
  description: string;
}

/**
 * Sends one snapshot to Mkhsistem's Gemini Vision bridge and asks only a
 * factual, non-judgmental question: is a person visible in frame, in the
 * role the camera is meant to watch (satpam/resepsionis). Deliberately does
 * NOT ask the model to judge "professionalism" or issue any disciplinary
 * verdict -- that stays a human (admin) decision, made later from the
 * monthly report. This is a raw presence record for that review, nothing
 * more.
 */
export async function detectPersonInZone(imageBase64: string, mimeType: string, zona: string): Promise<CctvDetectionResult> {
  const { data: setting, error } = await supabaseAdmin().from("integration_settings").select("value").eq("key", "vercel_bridge").maybeSingle();
  if (error) throw new Error(`Failed to load vercel_bridge setting: ${error.message}`);
  const baseUrl = setting?.value?.base_url as string | undefined;
  const secret = setting?.value?.secret as string | undefined;
  if (!baseUrl || !secret) {
    throw new Error("integration_settings.vercel_bridge (base_url/secret) is not configured");
  }

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/villa/ai/cctv-vision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify({ image: imageBase64, mimeType, zona }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success !== true) {
    throw new Error(`AI bridge failed: ${data?.error || res.status}`);
  }

  return {
    person_present: !!data.person_present,
    description: typeof data.description === "string" ? data.description : "",
  };
}

export interface PricingInsightInput {
  room_type_name: string;
  target_date: string;
  current_rate: number;
  recommended_rate: number;
  delta_pct: number;
  reason_codes: string[];
  guardrail_status: string;
  occupancy_pct: number | null;
  pickup_bookings_3d: number | null;
  confidence: "low" | "medium" | "high";
}

/**
 * Phase 8 (revenue-engine program): asks Mkhsistem's AI Service for a
 * plain-language EXPLANATION of a pricing recommendation the
 * deterministic rule engine (Phase 6) already computed -- reuses the
 * same bridge mechanism/secret as detectPersonInZone. Explanation only:
 * the model cannot change the rate and its text is never written into
 * villa_pricing_recommendations, only shown to the admin on demand
 * before they approve/reject.
 */
export async function explainPricingRecommendation(input: PricingInsightInput): Promise<string> {
  const { data: setting, error } = await supabaseAdmin().from("integration_settings").select("value").eq("key", "vercel_bridge").maybeSingle();
  if (error) throw new Error(`Failed to load vercel_bridge setting: ${error.message}`);
  const baseUrl = setting?.value?.base_url as string | undefined;
  const secret = setting?.value?.secret as string | undefined;
  if (!baseUrl || !secret) {
    throw new Error("integration_settings.vercel_bridge (base_url/secret) is not configured");
  }

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/villa/ai/pricing-insight`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success !== true) {
    throw new Error(`AI bridge failed: ${data?.error || res.status}`);
  }
  return typeof data.insight === "string" ? data.insight : "";
}

export interface CompetitorRateInput {
  location_label: string;
  room_type_name: string;
  room_type_description: string;
}

export interface CompetitorRateResult {
  competitor_name: string;
  competitor_type: "hotel" | "villa" | "other";
  price: number;
  source_note: string;
}

/**
 * High-season market research (owner request 2026-09-04): asks
 * Mkhsistem's AI Service to research nearby hotel/villa prices for a
 * given location using Gemini's Google Search grounding (public,
 * non-confidential listing pages only), so the deterministic Revenue
 * Engine can factor real nearby market prices into its high-season
 * floor. This is explicitly a RESEARCH step, not a decision -- results
 * land in villa_competitor_rates as source='ai_research' rows for an
 * admin to review/delete, exactly like a manual entry would; nothing
 * here writes to villa_rates or changes a live price by itself.
 */
export async function researchCompetitorRates(input: CompetitorRateInput): Promise<CompetitorRateResult[]> {
  const { data: setting, error } = await supabaseAdmin().from("integration_settings").select("value").eq("key", "vercel_bridge").maybeSingle();
  if (error) throw new Error(`Failed to load vercel_bridge setting: ${error.message}`);
  const baseUrl = setting?.value?.base_url as string | undefined;
  const secret = setting?.value?.secret as string | undefined;
  if (!baseUrl || !secret) {
    throw new Error("integration_settings.vercel_bridge (base_url/secret) is not configured");
  }

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/villa/ai/competitor-pricing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success !== true) {
    throw new Error(`AI bridge failed: ${data?.error || res.status}`);
  }
  return Array.isArray(data.results) ? data.results : [];
}

export type DemandTrend = "naik" | "turun" | "stabil";

export interface MarketDemandEvent {
  label: string;
  start_date: string;
  end_date: string;
  expected_impact: "low" | "medium" | "high";
  /**
   * "recurring" = a certain, yearly seasonal peak (New Year, Lebaran,
   * school holidays); "announced" = a scheduled event found published.
   * The pricing engine prices the first ahead of time and makes the
   * second earn its uplift from real pickup. Missing = "announced",
   * the cautious side, so an older bridge deployment cannot silently
   * turn every event into an advance price rise.
   */
  certainty?: "recurring" | "announced";
  source_note: string;
}

export interface MarketDemandResult {
  demand_trend: DemandTrend;
  trend_note: string;
  events: MarketDemandEvent[];
  /**
   * Minat pencarian pasar per bulan, 0-100, mis. { "2026-10": 62 }.
   *
   * Opsional dengan sengaja: jembatan AI yang belum diperbarui tidak
   * mengirimkannya, dan mesin harga memperlakukan ketiadaannya sebagai
   * "sinyal ini tidak ikut bicara" -- bukan sebagai nol.
   *
   * Sebelum ini penelitian yang sama hanya menghasilkan SATU KATA
   * (demand_trend: naik/turun/stabil) yang dilaporkan lalu tidak pernah
   * dipakai menentukan harga sama sekali. Angka per bulan membuatnya
   * benar-benar terpakai.
   */
  search_index_by_month?: Record<string, number>;
}

/**
 * Market-demand research (owner request 2026-09-11, follow-up to
 * researchCompetitorRates above): general Google-search interest for
 * villa/homestay rentals near the location, plus real upcoming events/
 * festivals/holidays that plausibly raise demand -- explicitly NOT
 * Google Analytics (confirmed via AskUserQuestion; no GA4 property
 * exists for villa's site to read). Same research-only discipline: this
 * never writes a price itself. The caller (aiPricingEngine.ts) lands
 * events in villa_high_season_periods, tagged
 * created_by='ai_jogja_events_research' so they're distinguishable from
 * a manual entry, for the existing rule engine to read exactly like any
 * other high-season period.
 */
export async function researchMarketDemand(locationLabel: string): Promise<MarketDemandResult> {
  const { data: setting, error } = await supabaseAdmin().from("integration_settings").select("value").eq("key", "vercel_bridge").maybeSingle();
  if (error) throw new Error(`Failed to load vercel_bridge setting: ${error.message}`);
  const baseUrl = setting?.value?.base_url as string | undefined;
  const secret = setting?.value?.secret as string | undefined;
  if (!baseUrl || !secret) {
    throw new Error("integration_settings.vercel_bridge (base_url/secret) is not configured");
  }

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/villa/ai/market-demand`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify({ location_label: locationLabel }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success !== true) {
    throw new Error(`AI bridge failed: ${data?.error || res.status}`);
  }
  const trend: DemandTrend = data.demand_trend === "naik" || data.demand_trend === "turun" ? data.demand_trend : "stabil";
  const rawIndex = data.search_index_by_month;
  let searchIndex: Record<string, number> | undefined;
  if (rawIndex && typeof rawIndex === "object") {
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawIndex as Record<string, unknown>)) {
      const n = Number(v);
      // Disaring di sini, bukan dipercaya apa adanya: keluaran AI bisa
      // mengandung bulan berformat aneh atau angka di luar 0-100, dan
      // angka liar yang lolos akan langsung menggerakkan harga tamu.
      if (/^\d{4}-\d{2}$/.test(k) && Number.isFinite(n) && n >= 0 && n <= 100) cleaned[k] = n;
    }
    if (Object.keys(cleaned).length >= 3) searchIndex = cleaned;
  }

  return {
    demand_trend: trend,
    trend_note: typeof data.trend_note === "string" ? data.trend_note : "",
    events: Array.isArray(data.events) ? data.events : [],
    search_index_by_month: searchIndex,
  };
}
