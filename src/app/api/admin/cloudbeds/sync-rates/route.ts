import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";
import { syncCloudbedsRates } from "@/lib/cloudbedsRateSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Manual "Sinkron Harga Sekarang" trigger on /admin/cloudbeds -- runs the
 * same logic as the daily cron (src/app/api/cron/sync-cloudbeds-rates)
 * on demand, so the owner can verify a price sync immediately instead of
 * waiting for the next 00:25 WIB run.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await syncCloudbedsRates(supabaseAdmin());
  return NextResponse.json(summary);
}
