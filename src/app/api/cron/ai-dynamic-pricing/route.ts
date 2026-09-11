import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runAiDynamicPricing } from "@/lib/aiDynamicPricingRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Owner-approved (2026-09-11) AI dynamic pricing cron -- see
 * src/lib/aiDynamicPricingRun.ts for the full design/rationale. Runs
 * just ahead of sync-cloudbeds-rates (23:05 WIB) so that cron's pull
 * picks up whatever this one pushed, once Cloudbeds' async rate job
 * finishes.
 *
 * Pushes nothing while villa_pricing_settings.ai_autopush_enabled is
 * false (its default): it computes and reports, and the live price
 * keeps following Cloudbeds.
 */
export async function GET(request: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await runAiDynamicPricing(supabaseAdmin());
  return NextResponse.json(summary);
}
