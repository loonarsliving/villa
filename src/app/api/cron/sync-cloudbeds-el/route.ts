import { NextResponse } from "next/server";

import { CloudbedsApiError } from "@/lib/cloudbedsApi";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { KunciElDitolak, syncCloudbedsEl } from "@/lib/elCloudbedsSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sinkron Cloudbeds Excellent Living tiap 10 menit (pg_cron
 * `villa-sync-cloudbeds-el`), padanan /api/cron/sync-cloudbeds-reservations
 * Private Living: tarik reservasi + kirim booking front desk EL. Lihat
 * src/lib/elCloudbedsSync.ts.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncCloudbedsEl());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/sync-cloudbeds-el] gagal", message);
    return NextResponse.json({ error: message, ...(e instanceof KunciElDitolak ? { kunci: e.periksa } : {}) }, { status: e instanceof CloudbedsApiError ? e.status : 502 });
  }
}
