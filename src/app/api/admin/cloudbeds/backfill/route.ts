import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { syncCloudbedsReservations } from "@/lib/cloudbedsReservationSync";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The admin "Tarik Reservasi" button. Everything it does now lives in
 * src/lib/cloudbedsReservationSync.ts, shared with the scheduled pull in
 * /api/cron/sync-cloudbeds-reservations, so the two can never drift.
 *
 * Kept even though the pull is automatic now: it is the way to catch up
 * immediately rather than waiting for the next tick, and the way to see
 * the unmapped-room and error detail when something looks wrong.
 */

const SUPABASE_URL = "https://svcmybsziaelwwdrnzcv.supabase.co";

export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = (process.env.CLOUDBEDS_API_KEY ?? "").trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Cloudbeds API key belum dikonfigurasi (CLOUDBEDS_API_KEY)" }, { status: 503 });
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi" }, { status: 503 });
  }
  const supabase: SupabaseClient = createClient(SUPABASE_URL, serviceRoleKey);

  try {
    return NextResponse.json(await syncCloudbedsReservations(supabase, apiKey));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil reservasi dari Cloudbeds" }, { status: 502 });
  }
}
