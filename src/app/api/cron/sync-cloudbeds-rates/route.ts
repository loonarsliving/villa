import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { syncCloudbedsRates } from "@/lib/cloudbedsRateSync";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await syncCloudbedsRates(supabaseAdmin());
  console.log("[sync-cloudbeds-rates]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
