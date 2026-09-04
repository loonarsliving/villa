import { timingSafeEqual, createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

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
 *
 * Phase 2 hardening (revenue-engine program, docs/revenue-engine/):
 * schema validation, idempotency (exact-payload dedupe against
 * cloudbeds_events_log), guest deduplication by phone, and cancellation
 * handling. See docs/revenue-engine/PHASE2-DESIGN.md for the full
 * rationale, including the explicitly UNCONFIRMED cancellation event
 * name (Cloudbeds' exact eventType string for a cancellation was never
 * verified against a real account in this project's audit trail).
 */

const SUPABASE_URL = "https://svcmybsziaelwwdrnzcv.supabase.co";

const ACTIVE_EVENT_TYPES = ["reservation.created", "reservation.updated"] as const;
// UNCONFIRMED: Cloudbeds' actual cancellation event name. Both plausible
// spellings are handled defensively; verify against a real Cloudbeds
// webhook delivery (or their docs, once reachable) before relying on
// this in production -- see PHASE2-DESIGN.md.
const CANCELLATION_EVENT_TYPES = ["reservation.cancelled", "reservation.canceled"] as const;

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Mirrors villa-api's own sendWa() contract exactly (integration_settings
 * key 'vercel_bridge' -> POST {base_url}/api/wa/send with x-internal-secret,
 * logged to wa_messages_log) -- duplicated here rather than shared because
 * this route runs on Vercel/Node and villa-api is a separate Supabase Edge
 * Function (Deno), different runtimes that can't share source.
 */
async function sendWaBridge(supabase: SupabaseClient, phone: string | null, message: string, meta: Record<string, unknown>) {
  if (!phone) {
    await supabase.from("wa_messages_log").insert({ ...meta, phone: null, message, status: "skipped_no_phone" });
    return;
  }
  const { data: setting } = await supabase.from("integration_settings").select("value").eq("key", "vercel_bridge").maybeSingle();
  const bridge = (setting?.value as { base_url?: string; secret?: string } | null) ?? {};
  if (!bridge.base_url || !bridge.secret) {
    await supabase.from("wa_messages_log").insert({ ...meta, phone, message, status: "skipped_not_configured" });
    return;
  }
  try {
    const r = await fetch(`${bridge.base_url.replace(/\/+$/, "")}/api/wa/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": bridge.secret },
      body: JSON.stringify({ phone, message, ...meta }),
    });
    const result = await r.json().catch(() => null);
    await supabase.from("wa_messages_log").insert({
      ...meta,
      phone,
      message,
      status: r.ok && result?.success ? "sent" : "failed",
      response: result ?? { http_status: r.status },
    });
  } catch (e) {
    await supabase.from("wa_messages_log").insert({ ...meta, phone, message, status: "error", response: { error: String(e) } });
  }
}

// Phase 2: schema validation for the inbound Cloudbeds payload. Every
// field stays optional at this layer (Cloudbeds' exact contract per
// event type isn't fully confirmed -- see PHASE2-DESIGN.md) but wrong
// *types* (a number where a string is expected, etc.) are now rejected
// before anything touches the database, instead of flowing through as
// `undefined` and silently producing bad rows.
const ReservationSchema = z
  .object({
    roomId: z.string().optional(),
    room_id: z.string().optional(),
    reservationId: z.string().optional(),
    id: z.string().optional(),
    guestName: z.string().optional(),
    guest_name: z.string().optional(),
    guestPhone: z.string().nullable().optional(),
    guest_phone: z.string().nullable().optional(),
    los: z.number().optional(),
    checkInDate: z.string().optional(),
    checkin_date: z.string().optional(),
    checkOutDate: z.string().nullable().optional(),
    checkout_date: z.string().nullable().optional(),
    total: z.number().optional(),
  })
  .passthrough();

const WebhookPayloadSchema = z
  .object({
    event: z.string().optional(),
    eventType: z.string().optional(),
    reservation: ReservationSchema.optional(),
    data: ReservationSchema.optional(),
  })
  .passthrough();

type CloudbedsReservation = z.infer<typeof ReservationSchema>;

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

  const rawPayload = await request.json().catch(() => null);
  if (rawPayload === null) {
    await supabase.from("cloudbeds_events_log").insert({
      reservation_id: null,
      event_type: "unknown",
      payload: {},
      matched: false,
      error: "invalid_json_body",
    });
    return NextResponse.json({ success: true, matched: false, note: "invalid JSON body, logged" });
  }

  const parsed = WebhookPayloadSchema.safeParse(rawPayload);
  const payload = (parsed.success ? parsed.data : rawPayload) as Record<string, unknown>;
  const eventType = (payload.event as string) ?? (payload.eventType as string) ?? "unknown";
  const reservation: CloudbedsReservation = (payload.reservation as CloudbedsReservation) ?? (payload.data as CloudbedsReservation) ?? {};
  const cloudbedsRoomId = reservation.roomId ?? reservation.room_id ?? null;
  const reservationId = reservation.reservationId ?? reservation.id ?? null;

  if (!parsed.success) {
    await supabase.from("cloudbeds_events_log").insert({
      reservation_id: reservationId,
      event_type: eventType,
      payload: rawPayload as Record<string, unknown>,
      matched: false,
      error: `schema_validation_failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    });
    // Still 200 -- a schema mismatch is something we want visible in the
    // log for a human to look at, not something Cloudbeds should retry
    // indefinitely with the same malformed body.
    return NextResponse.json({ success: true, matched: false, note: "payload failed schema validation, logged" });
  }

  // Phase 2 idempotency: an exact-duplicate delivery (same reservation_id
  // + event_type + payload body) is treated as a retry and skipped
  // entirely -- no re-processing, no duplicate guest/booking/notification/
  // WA side effects, no duplicate log row. A payload that differs at all
  // (e.g. a genuinely new reservation.updated a minute later) is not
  // considered a duplicate and is processed normally.
  if (reservationId && eventType !== "unknown") {
    const payloadHash = stableHash(payload);
    const { data: existingEvents } = await supabase
      .from("cloudbeds_events_log")
      .select("id, payload")
      .eq("reservation_id", reservationId)
      .eq("event_type", eventType)
      .order("created_at", { ascending: false })
      .limit(20);
    const isDuplicate = (existingEvents ?? []).some((row) => stableHash(row.payload) === payloadHash);
    if (isDuplicate) {
      return NextResponse.json({ success: true, matched: false, duplicate: true });
    }
  }

  let matched = false;
  let unitId: string | null = null;
  let unitNomor: string | null = null;
  let logError: string | null = null;

  try {
    if (cloudbedsRoomId && (ACTIVE_EVENT_TYPES as readonly string[]).includes(eventType)) {
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

        // Phase 2: guest dedup by phone. A reservation.updated event for
        // the same reservation previously created a brand-new `guests`
        // row every time -- now reuses an existing guest with the same
        // phone number instead of inserting a duplicate. Guests with no
        // phone on file still get a fresh row each time (no reliable key
        // to dedupe on without one), matching prior behavior for that case.
        let guestId: string | null = null;
        if (guestHp) {
          const { data: existingGuest } = await supabase.from("guests").select("id").eq("hp", guestHp).limit(1).maybeSingle();
          guestId = existingGuest?.id ?? null;
        }
        if (!guestId && guestNama) {
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

          // Tugas housekeeping "lengkapi amenities" untuk booking OTA ini --
          // muncul di checklist Housekeeping (front-desk/housekeeping) di
          // samping tugas "bersih" biasa. jenis='amenities' membuat
          // villa-api's /housekeeping/done otomatis mengurangi stock sesuai
          // kit standar saat tugas ini ditandai selesai, tanpa mengubah
          // status unit (itu tetap urusan tugas bersih-bersih checkout).
          await supabase.from("housekeeping").insert({
            unit_id: unitId,
            unit_nomor: unitNomor,
            jenis: "amenities",
            tugas: `Lengkapi amenities kamar untuk tamu OTA (${guestNama})`,
            tgl: reservation.checkInDate ?? reservation.checkin_date ?? new Date().toISOString().split("T")[0],
          });

          const checkinTgl = reservation.checkInDate ?? reservation.checkin_date ?? "-";
          const waMeta = { booking_id: null, unit_id: unitId, template_type: "ota_booking_alert" };

          // Housekeeping: nomor HP diambil dari data karyawan Mkhsistem (bukan
          // villa_staff sendiri) -- karyawan yang di-assign ke Division
          // "Housekeeping Villa" di Mkhsistem, per keputusan owner supaya data
          // karyawan tetap satu sumber (Mkhsistem HR), bukan didupilkasi di
          // villa. employment_status='active' (bukan cuma is_active) karena
          // itu field yang benar-benar berarti "masih bekerja" di skema ini.
          const { data: housekeepingStaff } = await supabase
            .from("employees")
            .select("phone, full_name, divisions!inner(name)")
            .ilike("divisions.name", "Housekeeping Villa")
            .eq("employment_status", "active")
            .is("deleted_at", null);
          for (const staff of (housekeepingStaff as { phone: string | null; full_name: string }[] | null) ?? []) {
            await sendWaBridge(
              supabase,
              staff.phone,
              `Halo ${staff.full_name}, ada booking OTA baru masuk — Unit ${unitNomor} (${guestNama}), checkin ${checkinTgl}. Tolong siapkan amenities kamar sesuai checklist Housekeeping.`,
              waMeta,
            );
          }

          // Reception: nomor HP dari villa_users sendiri (role receptionist,
          // aktif) -- data ini sudah ada di villa, tidak perlu ke Mkhsistem.
          const { data: receptionists } = await supabase.from("villa_users").select("hp, nama").eq("role", "receptionist").eq("is_active", true);
          for (const r of (receptionists as { hp: string | null; nama: string }[] | null) ?? []) {
            await sendWaBridge(
              supabase,
              r.hp,
              `Halo ${r.nama}, ada booking OTA baru — Unit ${unitNomor} (${guestNama}), checkin ${checkinTgl}. Siapkan penyambutan tamu.`,
              waMeta,
            );
          }
        }
      }
    } else if ((CANCELLATION_EVENT_TYPES as readonly string[]).includes(eventType) && reservationId) {
      // Phase 2: cancellation handling. Finds the existing booking by
      // cloudbeds_reservation_id and marks it 'batal' -- does not touch
      // any booking that isn't already tracked (nothing to cancel), and
      // never deletes a row (cancellation is a status change, matching
      // how a manual cancellation already works elsewhere in this app).
      const { data: existingBooking } = await supabase
        .from("bookings")
        .select("id, unit_id, unit_nomor, guest_nama, status")
        .eq("cloudbeds_reservation_id", reservationId)
        .maybeSingle();

      if (existingBooking) {
        matched = true;
        unitId = existingBooking.unit_id;
        unitNomor = existingBooking.unit_nomor;
        if (existingBooking.status !== "checkout" && existingBooking.status !== "batal") {
          await supabase.from("bookings").update({ status: "batal" }).eq("id", existingBooking.id);
          await supabase.from("notifications").insert({
            unit_id: existingBooking.unit_id,
            target_role: "all",
            tipe: "booking",
            judul: `Booking dibatalkan (Cloudbeds) — Unit ${existingBooking.unit_nomor}`,
            pesan: `${existingBooking.guest_nama} — reservasi dibatalkan di Cloudbeds.`,
            ref_id: reservationId,
          });
        }
        // A booking already checked-in/checked-out is left as-is -- an
        // OTA cancellation arriving after the guest already physically
        // stayed is a data-inconsistency case for a human to look at via
        // the event log, not something to silently overwrite.
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
