import { NextResponse } from "next/server";

import { syncCloudbedsReservations } from "@/lib/cloudbedsReservationSync";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pulls Cloudbeds reservations on a schedule instead of waiting for
 * somebody to press "Tarik Reservasi" (owner instruction 2026-09-12:
 * "tarik reservasi dri cloudbeds ini sifatnya otomatis, jgan harus slalu
 * di klik tarik reservasi").
 *
 * This is not a backup for the inbound webhook -- it replaces it in
 * practice. cloudbeds_events_log is completely empty: the webhook has
 * never delivered a single event since it was built, so every OTA booking
 * that ever reached this system got here because a human pressed that
 * button. A booking that nobody notices is a double-booking waiting to
 * happen, which is why this runs often rather than nightly.
 *
 * Safe to run as often as we like: the sync upserts on
 * cloudbeds_reservation_id, so a reservation seen twenty times still
 * produces exactly one booking row, and it deliberately sends no WhatsApp
 * or housekeeping alerts.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = (process.env.CLOUDBEDS_API_KEY ?? "").trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Cloudbeds API key belum dikonfigurasi (CLOUDBEDS_API_KEY)" }, { status: 503 });
  }

  try {
    const summary = await syncCloudbedsReservations(supabaseAdmin(), apiKey);
    return NextResponse.json(summary);
  } catch (e) {
    // Logged loudly rather than swallowed: a silently failing pull looks
    // exactly like a quiet week of no bookings.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/sync-cloudbeds-reservations] failed", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
