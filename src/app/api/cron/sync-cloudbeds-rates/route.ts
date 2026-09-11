import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { syncCloudbedsRates } from "@/lib/cloudbedsRateSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Owner instruction (2026-09-11): villa's own guest-facing rate
 * (units.tarif_harian) should directly follow Cloudbeds' live rate --
 * that rate is already what's distributed to every OTA through
 * Cloudbeds' channel manager, and the owner is planning a future AI that
 * adjusts price on the Cloudbeds side, which this should just mirror.
 * Explicitly NOT the Phase 6 "pending_review" flow (that stays as-is for
 * the deterministic rule engine's own recommendations) -- this is a
 * separate, owner-approved direct-write path, confirmed via
 * AskUserQuestion before building it. Actual sync logic lives in
 * src/lib/cloudbedsRateSync.ts, shared with the admin manual-trigger
 * endpoint (src/app/api/admin/cloudbeds/sync-rates).
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

  const summary = await syncCloudbedsRates(supabaseAdmin());
  return NextResponse.json(summary);
}
