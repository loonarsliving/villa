import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";
import { runAiDynamicPricing } from "@/lib/aiDynamicPricingRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manual trigger on /admin/cloudbeds. Defaults to compute-and-record
 * only (no price leaves the building); pass {"push": true} to also send
 * the decided rates to Cloudbeds as a deliberate test, independent of
 * the nightly cron's ai_autopush_enabled switch.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const push = body?.push === true;

  const summary = await runAiDynamicPricing(supabaseAdmin(), push);
  return NextResponse.json(summary);
}
