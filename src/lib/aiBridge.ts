import "server-only";

/**
 * Villa has no Gemini integration or GEMINI_API_KEY of its own. Instead, the
 * AI CCTV module's checkpoint detection calls into Mkhsistem's existing AI
 * Service via a dedicated bridge endpoint (loonarsliving/Mkhsistem's
 * app/api/villa/ai/cctv-vision), the same pattern as the WhatsApp bridge
 * (/api/wa/send) villa already relies on. This rides Mkhsistem's shared
 * retry/backoff, circuit breaker, and telemetry instead of villa needing a
 * second, unmonitored Gemini credential.
 */

const BRIDGE_URL = process.env.MKHSISTEM_AI_BRIDGE_URL || "https://mkh.haluoleo.id/api/villa/ai/cctv-vision";

export interface CctvDetectionResult {
  person_present: boolean;
  description: string;
}

export function isAiBridgeConfigured(): boolean {
  return !!process.env.VILLA_BRIDGE_SECRET;
}

/**
 * Sends one snapshot to Mkhsistem's Gemini Vision bridge and asks only a
 * factual, non-judgmental question: is a person visible in frame.
 * Deliberately does NOT ask the model to judge "professionalism" or
 * "cleanliness" -- that is not something an AI can assess from a still
 * image, and the checkpoint log is meant as a raw presence record for a
 * human (Avianto) to review, not an automated verdict.
 */
export async function detectPersonInZone(imageBase64: string, mimeType: string, zona: string): Promise<CctvDetectionResult> {
  const secret = process.env.VILLA_BRIDGE_SECRET;
  if (!secret) {
    throw new Error("VILLA_BRIDGE_SECRET is not configured");
  }

  const res = await fetch(BRIDGE_URL, {
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
