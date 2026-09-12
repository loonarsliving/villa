import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCloudbedsReservationTotals } from "@/lib/cloudbedsApi";
import { NextResponse } from "next/server";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time/on-demand backfill: pulls active & upcoming reservations
 * (not_confirmed/confirmed/checked_in -- never canceled/no_show/checked_out)
 * from Cloudbeds for every mapped room and upserts them into `bookings`,
 * same onConflict('cloudbeds_reservation_id') key as the live webhook route
 * uses -- safe to re-run, never creates duplicates. Deliberately skips WA/
 * housekeeping/notifications (unlike the webhook route) since these are
 * pre-existing reservations being caught up, not new alerts for staff.
 * Only the first mapped room per reservation is used, matching the rest of
 * this app's single-room-per-reservation assumption (see the webhook
 * route's comments).
 */

const SUPABASE_URL = "https://svcmybsziaelwwdrnzcv.supabase.co";
const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";
const ACTIVE_STATUSES = ["not_confirmed", "confirmed", "checked_in"] as const;

interface CloudbedsRoomAssignment {
  roomID?: string | null;
  roomCheckIn?: string;
  roomCheckOut?: string;
  guestID?: string;
}
interface CloudbedsGuestDetail {
  guestFirstName?: string | null;
  guestLastName?: string | null;
  guestPhone?: string | null;
  guestCellPhone?: string | null;
}
interface CloudbedsReservation {
  reservationID: string;
  status: string;
  guestName?: string;
  startDate: string;
  endDate: string;
  rooms?: CloudbedsRoomAssignment[];
  guestList?: Record<string, CloudbedsGuestDetail>;
}

async function fetchAllActiveReservations(apiKey: string): Promise<CloudbedsReservation[]> {
  const today = new Date().toISOString().slice(0, 10);
  const propertyId = (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim();
  const all: CloudbedsReservation[] = [];
  let pageNumber = 1;
  const pageSize = 100;
  for (;;) {
    const url = new URL(`${CLOUDBEDS_API_BASE}/getReservations`);
    if (propertyId) url.searchParams.set("propertyID", propertyId);
    url.searchParams.set("checkOutFrom", today);
    url.searchParams.set("includeAllRooms", "true");
    url.searchParams.set("includeGuestsDetails", "true");
    url.searchParams.set("pageNumber", String(pageNumber));
    url.searchParams.set("pageSize", String(pageSize));
    const res = await fetch(url, { headers: { "x-api-key": apiKey }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success === false) {
      throw new Error(body?.message || body?.error || `Cloudbeds getReservations error (HTTP ${res.status})`);
    }
    const rows = (body?.data ?? []) as CloudbedsReservation[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    pageNumber++;
  }
  return all;
}

function statusToVilla(status: string): string {
  if (status === "checked_in") return "checkin";
  return "terjadwal";
}

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

  let allReservations: CloudbedsReservation[];
  try {
    allReservations = await fetchAllActiveReservations(apiKey);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil reservasi dari Cloudbeds" }, { status: 502 });
  }

  const statusCounts: Record<string, number> = {};
  for (const r of allReservations) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  const reservations = allReservations.filter((r) => (ACTIVE_STATUSES as readonly string[]).includes(r.status));

  // getReservations carries no total at all (see
  // getCloudbedsReservationTotals) -- without this every row below landed
  // with tarif = 0 and counted as zero revenue.
  let totalsById = new Map<string, Awaited<ReturnType<typeof getCloudbedsReservationTotals>> extends Map<string, infer V> ? V : never>();
  try {
    totalsById = await getCloudbedsReservationTotals({ checkOutFrom: new Date().toISOString().slice(0, 10) });
  } catch {
    // A missing total must never block a booking from being recorded.
  }

  const { data: mappings } = await supabase.from("cloudbeds_room_mapping").select("cloudbeds_room_id, unit_id, units(nomor)");
  type MappingRow = { unit_id: string; units: { nomor: string }[] | { nomor: string } | null };
  const mappingByRoomId = new Map(
    (mappings ?? []).map((m) => [String(m.cloudbeds_room_id), m as unknown as MappingRow]),
  );

  let matched = 0;
  let inserted = 0;
  let skippedUnmapped = 0;
  const unmappedRoomIds: string[] = [];
  const errors: string[] = [];

  for (const resv of reservations) {
    const room = (resv.rooms ?? []).find((r) => r.roomID && mappingByRoomId.has(String(r.roomID)));
    if (!room?.roomID) {
      skippedUnmapped++;
      for (const r of resv.rooms ?? []) if (r.roomID) unmappedRoomIds.push(String(r.roomID));
      continue;
    }
    const mapping = mappingByRoomId.get(String(room.roomID))!;
    const unitNomor = Array.isArray(mapping.units) ? (mapping.units[0]?.nomor ?? null) : (mapping.units?.nomor ?? null);
    matched++;

    const checkIn = room.roomCheckIn ?? resv.startDate;
    const checkOut = room.roomCheckOut ?? resv.endDate;
    const nights = checkOut ? Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000) : 0;
    // `tarif` holds the WHOLE-STAY amount in this schema, not a nightly
    // rate: villa-api writes `tarif: computedTarif, total_bayar:
    // computedTarif` for every website booking, the Payment Gateway page
    // does the same, and the UI reads `total_bayar ?? tarif` as the
    // amount owed. A per-night figure here would read as a stay that
    // cost a third of what it did. durasi_malam is stored alongside, so
    // the nightly rate stays derivable.
    const totals = totalsById.get(resv.reservationID) ?? null;
    const stayTotal = totals ? totals.grandTotal : 0;

    const guestDetail = room.guestID ? resv.guestList?.[room.guestID] : undefined;
    const guestNama =
      guestDetail?.guestFirstName || guestDetail?.guestLastName
        ? `${guestDetail?.guestFirstName ?? ""} ${guestDetail?.guestLastName ?? ""}`.trim()
        : (resv.guestName ?? "Tamu Cloudbeds");
    const guestHp = guestDetail?.guestPhone ?? guestDetail?.guestCellPhone ?? null;

    try {
      let guestId: string | null = null;
      if (guestHp) {
        const { data: existingGuest } = await supabase.from("guests").select("id").eq("hp", guestHp).limit(1).maybeSingle();
        guestId = existingGuest?.id ?? null;
      }
      if (!guestId) {
        const { data: g } = await supabase.from("guests").insert({ nama: guestNama, hp: guestHp }).select("id").single();
        guestId = g?.id ?? null;
      }

      const { error } = await supabase.from("bookings").upsert(
        {
          unit_id: mapping.unit_id,
          unit_nomor: unitNomor,
          guest_id: guestId,
          guest_nama: guestNama,
          tipe: "harian",
          sumber: "cloudbeds",
          tgl_checkin: checkIn,
          tgl_checkout: checkOut,
          durasi_malam: nights > 0 ? nights : null,
          tarif: stayTotal,
          total_bayar: stayTotal,
          status: statusToVilla(resv.status),
          cloudbeds_reservation_id: resv.reservationID,
        },
        { onConflict: "cloudbeds_reservation_id" },
      );
      if (error) {
        errors.push(`${resv.reservationID}: ${error.message}`);
      } else {
        inserted++;
      }
    } catch (e) {
      errors.push(`${resv.reservationID}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log("[cloudbeds-backfill]", JSON.stringify({
    property_id_used: (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim() || null,
    fetched_total: allReservations.length,
    fetched_active: reservations.length,
    status_counts: statusCounts,
    matched,
    inserted,
    skipped_unmapped: skippedUnmapped,
    unmapped_room_ids: [...new Set(unmappedRoomIds)].slice(0, 20),
    errors: errors.slice(0, 20),
  }));

  return NextResponse.json({
    success: true,
    fetched_total: allReservations.length,
    fetched_active: reservations.length,
    status_counts: statusCounts,
    matched,
    inserted,
    skipped_unmapped: skippedUnmapped,
    unmapped_room_ids: [...new Set(unmappedRoomIds)].slice(0, 20),
    errors: errors.slice(0, 20),
  });
}
