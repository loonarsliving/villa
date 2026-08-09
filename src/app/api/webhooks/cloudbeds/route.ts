import { timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cloudbeds webhook receiver, handled directly in Vercel instead of the
 * Supabase Edge Function -- credentials (CLOUDBEDS_WEBHOOK_SECRET,
 * SUPABASE_SERVICE_ROLE_KEY) live only as Vercel env vars on this project,
 * never in the database, mirroring the pattern already used for the
 * WhatsApp bridge on mkhsistem. Cloudbeds is purely a channel manager here
 * (syncs OTA availability/bookings) -- check-in/check-out stay a manual
 * Front Desk action, there's no smart lock to trigger automatically.
 */

const SUPABASE_URL = "https://svcmybsziaelwwdrnzcv.supabase.co";

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

interface CloudbedsReservation {
  roomId?: string;
  room_id?: string;
  reservationId?: string;
  id?: string;
  guestName?: string;
  guest_name?: string;
  guestPhone?: string;
  guest_phone?: string;
  los?: number;
  checkInDate?: string;
  checkin_date?: string;
  checkOutDate?: string;
  checkout_date?: string;
  total?: number;
}

export async function POST(request: Request) {
  const expected = (process.env.CLOUDBEDS_WEBHOOK_SECRET ?? "").trim();
  if (!expected) {
    return NextResponse.json({ error: "Cloudbeds webhook belum dikonfigurasi (CLOUDBEDS_WEBHOOK_SECRET)" }, { status: 503 });
  }
  const provided = (request.headers.get("x-cloudbeds-secret") ?? "").trim();
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi" }, { status: 503 });
  }
  const supabase = createClient(SUPABASE_URL, serviceRoleKey);

  const payload = await request.json().catch(() => ({}) as Record<string, unknown>);
  const eventType = (payload.event as string) ?? (payload.eventType as string) ?? "unknown";
  const reservation: CloudbedsReservation = (payload.reservation as CloudbedsReservation) ?? (payload.data as CloudbedsReservation) ?? {};
  const cloudbedsRoomId = reservation.roomId ?? reservation.room_id ?? null;
  const reservationId = reservation.reservationId ?? reservation.id ?? null;

  let matched = false;
  let unitId: string | null = null;
  let unitNomor: string | null = null;
  let logError: string | null = null;

  try {
    if (cloudbedsRoomId && (eventType === "reservation.created" || eventType === "reservation.updated")) {
      const { data: mapping } = await supabase
        .from("cloudbeds_room_mapping")
        .select("unit_id, units(nomor)")
        .eq("cloudbeds_room_id", cloudbedsRoomId)
        .maybeSingle<{ unit_id: string; units: { nomor: string } | null }>();

      if (mapping?.unit_id) {
        matched = true;
        unitId = mapping.unit_id;
        unitNomor = mapping.units?.nomor ?? null;

        const guestNama = reservation.guestName ?? reservation.guest_name ?? "Tamu Cloudbeds";
        const guestHp = reservation.guestPhone ?? reservation.guest_phone ?? null;
        let guestId: string | null = null;
        if (guestNama) {
          const { data: g } = await supabase.from("guests").insert({ nama: guestNama, hp: guestHp }).select("id").single();
          guestId = g?.id ?? null;
        }

        await supabase.from("bookings").upsert(
          {
            unit_id: unitId,
            unit_nomor: unitNomor,
            guest_id: guestId,
            guest_nama: guestNama,
            tipe: (reservation.los ?? 0) > 27 ? "bulanan" : "harian",
            sumber: "cloudbeds",
            tgl_checkin: reservation.checkInDate ?? reservation.checkin_date,
            tgl_checkout: reservation.checkOutDate ?? reservation.checkout_date,
            tarif: reservation.total ?? 0,
            total_bayar: reservation.total ?? 0,
            status: "terjadwal",
            cloudbeds_reservation_id: reservationId,
          },
          { onConflict: "cloudbeds_reservation_id" },
        );

        if (unitNomor) {
          await supabase.from("notifications").insert({
            unit_id: unitId,
            target_role: "all",
            tipe: "booking",
            judul: `Booking baru (Cloudbeds) — Unit ${unitNomor}`,
            pesan: `${guestNama} — cek Front Desk untuk proses check-in.`,
            ref_id: reservationId ?? null,
          });
        }
      }
    }
  } catch (e) {
    logError = e instanceof Error ? e.message : String(e);
  }

  await supabase.from("cloudbeds_events_log").insert({
    reservation_id: reservationId,
    event_type: eventType,
    payload,
    matched,
    error: logError,
  });

  return NextResponse.json({ success: true, matched });
}
