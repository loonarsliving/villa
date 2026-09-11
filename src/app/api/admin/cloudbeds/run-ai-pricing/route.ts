import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";
import { runAiDynamicPricing } from "@/lib/aiDynamicPricingRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manual "Jalankan AI Pricing Sekarang" trigger on /admin/cloudbeds --
 * runs the same logic as the daily cron (src/app/api/cron/ai-dynamic-pricing)
 * on demand, so the owner can verify a run (and see per-room-type errors,
 * e.g. missing write:rate scope on CLOUDBEDS_API_KEY) immediately.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runAiDynamicPricing(supabaseAdmin());
  return NextResponse.json(summary);
}
