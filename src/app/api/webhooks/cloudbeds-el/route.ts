import { timingSafeEqual, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getCloudbedsReservationTotals } from "@/lib/cloudbedsApi";
import { mapSourceNameToSumber } from "@/lib/cloudbedsSourceMapping";
import { statusSetelahSync } from "@/lib/bookingStatusSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook Cloudbeds untuk akun KEDUA: Loonars Excellent Living. Sama seperti
 * /api/webhooks/cloudbeds (Private Living) tetapi:
 *   - secret: CLOUDBEDS2_WEBHOOK_SECRET (header x-cloudbeds-secret)
 *   - total booking dibaca lewat CLOUDBEDS2_API_KEY / CLOUDBEDS2_PROPERTY_ID
 *   - hanya menulis tabel el_* (el_bookings, el_cloudbeds_room_mapping,
 *     el_cloudbeds_events_log) -- tidak pernah bookings/guests Private Living.
 * Belum mengirim WA/tugas housekeeping; booking cukup muncul di front desk EL.
 */

const SUPABASE_URL = "https://svcmybsziaelwwdrnzcv.supabase.co";
const ACTIVE_EVENT_TYPES = ["reservation.created", "reservation.updated"];
// Nama event pembatalan Cloudbeds belum pernah dipastikan -- lihat route Private Living.
const CANCELLATION_EVENT_TYPES = ["reservation.cancelled", "reservation.canceled"];

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function teks(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(request: Request) {
  const expected = (process.env.CLOUDBEDS2_WEBHOOK_SECRET ?? "").trim();
  if (!expected) {
    return NextResponse.json({ error: "Cloudbeds Excellent Living belum dikonfigurasi (CLOUDBEDS2_WEBHOOK_SECRET)" }, { status: 503 });
  }
  if (!secretsMatch((request.headers.get("x-cloudbeds-secret") ?? "").trim(), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi" }, { status: 503 });
  }
  const supabase = createClient(SUPABASE_URL, serviceRoleKey);

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    await supabase.from("el_cloudbeds_events_log").insert({ event_type: "unknown", payload: {}, matched: false, error: "invalid_json_body" });
    return NextResponse.json({ success: true, matched: false, note: "invalid JSON body, logged" });
  }

  const eventType = teks(payload.event) ?? teks(payload.eventType) ?? "unknown";
  const res = ((payload.reservation ?? payload.data ?? {}) as Record<string, unknown>) || {};
  const cloudbedsRoomId = teks(res.roomId) ?? teks(res.room_id);
  const reservationId = teks(res.reservationId) ?? teks(res.id);

  // Pengiriman ulang dengan isi persis sama dilewati.
  if (reservationId && eventType !== "unknown") {
    const hash = stableHash(payload);
    const { data: lama } = await supabase
      .from("el_cloudbeds_events_log")
      .select("payload")
      .eq("reservation_id", reservationId)
      .eq("event_type", eventType)
      .order("created_at", { ascending: false })
      .limit(20);
    if ((lama ?? []).some((r) => stableHash(r.payload) === hash)) {
      return NextResponse.json({ success: true, matched: false, duplicate: true });
    }
  }

  let matched = false;
  let logError: string | null = null;

  try {
    if (ACTIVE_EVENT_TYPES.includes(eventType) && cloudbedsRoomId && reservationId) {
      const { data: mapping } = await supabase
        .from("el_cloudbeds_room_mapping")
        .select("room_id, el_rooms(nomor)")
        .eq("cloudbeds_room_id", cloudbedsRoomId)
        .maybeSingle<{ room_id: string; el_rooms: { nomor: string } | { nomor: string }[] | null }>();
      const tglCheckin = teks(res.checkInDate) ?? teks(res.checkin_date);
      const tglCheckout = teks(res.checkOutDate) ?? teks(res.checkout_date);

      if (!mapping?.room_id) {
        logError = "room_not_mapped";
      } else if (!tglCheckin || !tglCheckout || tglCheckout <= tglCheckin) {
        logError = "invalid_dates";
      } else {
        const roomNomor = Array.isArray(mapping.el_rooms) ? (mapping.el_rooms[0]?.nomor ?? null) : (mapping.el_rooms?.nomor ?? null);
        let total = 0;
        try {
          total = (await getCloudbedsReservationTotals({ reservationIDs: [reservationId] }, "el")).get(reservationId)?.grandTotal ?? 0;
        } catch {
          // total tetap 0 -- booking tetap harus tercatat
        }
        const { data: saatIni } = await supabase.from("el_bookings").select("status").eq("cloudbeds_reservation_id", reservationId).maybeSingle();
        const malam = Math.round((Date.parse(`${tglCheckout}T00:00:00Z`) - Date.parse(`${tglCheckin}T00:00:00Z`)) / 86400000);
        const { error } = await supabase.from("el_bookings").upsert(
          {
            room_id: mapping.room_id,
            room_nomor: roomNomor,
            guest_nama: teks(res.guestName) ?? teks(res.guest_name) ?? "Tamu Cloudbeds",
            guest_hp: teks(res.guestPhone) ?? teks(res.guest_phone),
            sumber: mapSourceNameToSumber(teks(res.sourceName) ?? teks(res.source_name)),
            tgl_checkin: tglCheckin,
            tgl_checkout: tglCheckout,
            durasi_malam: malam,
            total_bayar: total,
            status: statusSetelahSync(saatIni?.status, "terjadwal"),
            cloudbeds_reservation_id: reservationId,
            dibuat_oleh: "cloudbeds",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "cloudbeds_reservation_id" },
        );
        if (error) logError = `el_bookings_upsert_failed: ${error.message}`;
        else matched = true;
      }
    } else if (CANCELLATION_EVENT_TYPES.includes(eventType) && reservationId) {
      const { data: b } = await supabase.from("el_bookings").select("id,status").eq("cloudbeds_reservation_id", reservationId).maybeSingle();
      if (b) {
        matched = true;
        // Tamu yang sudah check-in/out tidak diubah -- biar manusia yang memeriksa lewat log.
        if (b.status === "terjadwal") {
          await supabase.from("el_bookings").update({ status: "batal", updated_at: new Date().toISOString() }).eq("id", b.id);
        }
      }
    }
  } catch (e) {
    logError = e instanceof Error ? e.message : String(e);
  }

  await supabase.from("el_cloudbeds_events_log").insert({ reservation_id: reservationId, event_type: eventType, payload, matched, error: logError });
  return NextResponse.json({ success: true, matched });
}
