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

const MAX_NAME_LEN = 200;
const MAX_PHONE_LEN = 32;
// Loose but useful: digits, spaces and the common phone punctuation, 6-32 chars.
const PHONE_RE = /^[0-9+()\-.\s]{6,32}$/;

/**
 * Manual schema validation for the reservation payload before anything is
 * written to Supabase. `zod` is not a dependency of this project (see
 * package.json), so this is written by hand rather than pulling in a new
 * package for one file. Returns a list of human-readable problems; an empty
 * list means the payload is safe to write.
 */
function validateReservation(reservation: CloudbedsReservation): string[] {
  const problems: string[] = [];

  const guestName = reservation.guestName ?? reservation.guest_name;
  if (guestName !== undefined) {
    if (typeof guestName !== "string" || !guestName.trim()) {
      problems.push("guestName/guest_name must be a non-empty string");
    } else if (guestName.length > MAX_NAME_LEN) {
      problems.push(`guestName/guest_name exceeds ${MAX_NAME_LEN} characters`);
    }
  }

  const guestPhone = reservation.guestPhone ?? reservation.guest_phone;
  if (guestPhone !== undefined && guestPhone !== null) {
    if (typeof guestPhone !== "string" || guestPhone.length > MAX_PHONE_LEN || !PHONE_RE.test(guestPhone)) {
      problems.push("guestPhone/guest_phone has an invalid format");
    }
  }

  if (reservation.total !== undefined) {
    if (typeof reservation.total !== "number" || !Number.isFinite(reservation.total) || reservation.total < 0) {
      problems.push("total must be a non-negative number");
    }
  }

  const checkIn = reservation.checkInDate ?? reservation.checkin_date;
  const checkOut = reservation.checkOutDate ?? reservation.checkout_date;
  const checkInDate = checkIn !== undefined ? new Date(checkIn) : null;
  const checkOutDate = checkOut !== undefined ? new Date(checkOut) : null;

  // Required: the booking row we're about to write needs both dates.
  if (checkIn === undefined) {
    problems.push("checkInDate/checkin_date is required");
  } else if (typeof checkIn !== "string" || Number.isNaN(checkInDate?.getTime())) {
    problems.push("checkInDate/checkin_date must be a valid ISO date string");
  }
  if (checkOut === undefined) {
    problems.push("checkOutDate/checkout_date is required");
  } else if (typeof checkOut !== "string" || Number.isNaN(checkOutDate?.getTime())) {
    problems.push("checkOutDate/checkout_date must be a valid ISO date string");
  }
  if (
    checkInDate &&
    checkOutDate &&
    !Number.isNaN(checkInDate.getTime()) &&
    !Number.isNaN(checkOutDate.getTime()) &&
    checkOutDate.getTime() <= checkInDate.getTime()
  ) {
    problems.push("checkOutDate/checkout_date must be after checkInDate/checkin_date");
  }

  return problems;
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
        const problems = validateReservation(reservation);
        if (problems.length > 0) {
          console.warn("[cloudbeds webhook] rejected malformed reservation payload:", problems, {
            eventType,
            reservationId,
            cloudbedsRoomId,
          });
          await supabase.from("cloudbeds_events_log").insert({
            reservation_id: reservationId,
            event_type: eventType,
            payload,
            matched: false,
            error: `validation failed: ${problems.join("; ")}`,
          });
          return NextResponse.json({ error: "invalid reservation payload", details: problems }, { status: 400 });
        }

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
