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
