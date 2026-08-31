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
