import "server-only";

import { GoogleGenAI } from "@google/genai";

/**
 * Minimal Gemini Vision helper for the CCTV module, ported from Mkhsistem's
 * lib/ai/provider/gemini-provider.ts pattern (same @google/genai client,
 * same env vars) but trimmed to this module's one use case: "does this
 * snapshot show a person in the expected zone?". Mkhsistem's full AI Service
 * (retry/circuit-breaker/telemetry/job-queue) is tied to its own DB tables
 * (ai_job_queue, ai_circuit_breaker_state, ai_request_telemetry) that this
 * module doesn't own, so a direct call with basic retry is intentional here
 * rather than a shared dependency across repos.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? "20000");
const GEMINI_MAX_ATTEMPTS = Number(process.env.GEMINI_RETRY_MAX_ATTEMPTS ?? "3");

export interface CctvDetectionResult {
  person_present: boolean;
  description: string;
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

const ZONA_PROMPT: Record<string, string> = {
  security: "Ini adalah snapshot dari kamera keamanan pada sebuah titik patroli villa.",
  front_desk: "Ini adalah snapshot dari kamera yang mengawasi meja resepsionis/front desk villa.",
  housekeeping: "Ini adalah snapshot dari kamera di dalam atau di depan pintu kamar villa, untuk mencatat kunjungan cleaning service.",
};

/**
 * Sends one snapshot to Gemini Vision and asks only a factual, non-judgmental
 * question: is a person visible in frame. Deliberately does NOT ask the model
 * to judge "professionalism" or "cleanliness" -- that is not something an AI
 * can assess from a still image, and the checkpoint log is meant as a raw
 * presence record for a human (Avianto) to review, not an automated verdict.
 */
export async function detectPersonInZone(imageBase64: string, mimeType: string, zona: string): Promise<CctvDetectionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const client = new GoogleGenAI({ apiKey });
  const context = ZONA_PROMPT[zona] || "Ini adalah snapshot dari kamera CCTV villa.";
  const systemInstruction =
    "Kamu adalah sistem pencatat checkpoint CCTV. Tugasmu murni faktual: apakah ada orang yang terlihat di frame. " +
    "Jangan menilai kualitas kerja, profesionalisme, atau kebersihan -- itu bukan sesuatu yang bisa dinilai dari satu foto. " +
    'Balas HANYA dengan JSON valid berbentuk {"person_present": boolean, "description": string}. ' +
    "description singkat (maks 25 kata), bahasa Indonesia, jelaskan apa yang terlihat di frame secara netral.";

  let lastError: unknown;
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      try {
        const response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: [
            {
              role: "user",
              parts: [{ text: context }, { inlineData: { mimeType, data: imageBase64 } }],
            },
          ],
          config: {
            systemInstruction,
            temperature: 0.2,
            maxOutputTokens: 256,
            responseMimeType: "application/json",
          },
        });
        clearTimeout(timeout);
        const text = response.text ?? "";
        const parsed = JSON.parse(text) as Partial<CctvDetectionResult>;
        return {
          person_present: !!parsed.person_present,
          description: typeof parsed.description === "string" ? parsed.description : "",
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (e) {
      lastError = e;
      if (attempt < GEMINI_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
