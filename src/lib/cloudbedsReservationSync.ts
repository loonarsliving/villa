import type { SupabaseClient } from "@supabase/supabase-js";
import { getCloudbedsReservationTotals } from "@/lib/cloudbedsApi";

/**
 * Pulls active & upcoming reservations pulls active & upcoming reservations
 * (not_confirmed/confirmed/checked_in -- never canceled/no_show/checked_out)
 * from Cloudbeds for every mapped room and upserts them into `bookings`,
 * same onConflict('cloudbeds_reservation_id') key as the live webhook route
 * uses -- safe to re-run, never creates duplicates. Deliberately skips WA/
 * housekeeping/notifications (unlike the webhook route) since these are
 * pre-existing reservations being caught up, not new alerts for staff.
 * Only the first mapped room per reservation is used, matching the rest of
 * this app's single-room-per-reservation assumption (see the webhook
 * route's comments).
 *
 * Shared by the admin "Tarik Reservasi" button and the scheduled pull in
 * /api/cron/sync-cloudbeds-reservations, so the automatic path can never
 * drift from the one a human triggers -- owner instruction 2026-09-12:
 * "tarik reservasi dri cloudbeds ini sifatnya otomatis, jgan harus slalu
 * di klik tarik reservasi".
 *
 * Worth knowing why the scheduled pull exists at all: the inbound
 * Cloudbeds webhook has never delivered a single event --
 * cloudbeds_events_log is completely empty -- so until now the ONLY way a
 * reservation ever reached this system was somebody pressing that button.
 * A periodic reconcile is the right design regardless, since webhooks get
 * missed, but here it is not a safety net, it is the primary path.
 */

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

export interface ReservationSyncSummary {
  success: boolean;
  fetched_total: number;
  fetched_active: number;
  status_counts: Record<string, number>;
  matched: number;
  inserted: number;
  skipped_unmapped: number;
  /** Reservations that originated on our side and were deliberately not written back. */
  skipped_own: number;
  unmapped_room_ids: string[];
  errors: string[];
}

export async function syncCloudbedsReservations(supabase: SupabaseClient, apiKey: string): Promise<ReservationSyncSummary> {

  const allReservations: CloudbedsReservation[] = await fetchAllActiveReservations(apiKey);

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

  // Bookings that started HERE and were pushed out must never be written
  // back from Cloudbeds. They come back as ordinary reservations, and this
  // upsert would overwrite the whole row from Cloudbeds' copy: sumber
  // flipped from 'website' to 'cloudbeds', the unit replaced by whichever
  // room Cloudbeds assigned within the type, the guest name rebuilt from
  // the synthetic first/last split -- and the price replaced by whatever
  // Cloudbeds calculated, because postReservation carries no amount and
  // Cloudbeds prices the stay itself.
  //
  // That is not hypothetical. On 2026-09-12 it silently raised a paid
  // guest's total from Rp1,466,500 to Rp1,680,000, minutes after the
  // outbound push went live: she booked at the old New Year rate, we
  // pushed the booking without a price, Cloudbeds priced it at the new
  // one, and this sync copied that back over what she had already paid.
  //
  // A reservation id already attached to a booking whose sumber is not
  // 'cloudbeds' is ours. Skipped outright: OUR record is the authority for
  // a booking we created, not the mirror of it.
  const reservationIds = reservations.map((r) => r.reservationID);
  const ownReservationIds = new Set<string>();
  if (reservationIds.length > 0) {
    const { data: existing } = await supabase
      .from("bookings")
      .select("cloudbeds_reservation_id, sumber")
      .in("cloudbeds_reservation_id", reservationIds)
      .neq("sumber", "cloudbeds");
    for (const b of existing ?? []) {
      if (b.cloudbeds_reservation_id) ownReservationIds.add(String(b.cloudbeds_reservation_id));
    }
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

  let skippedOwn = 0;
  for (const resv of reservations) {
    if (ownReservationIds.has(resv.reservationID)) {
      skippedOwn++;
      continue;
    }
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

  console.log("[cloudbeds-reservation-sync]", JSON.stringify({
    property_id_used: (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim() || null,
    fetched_total: allReservations.length,
    fetched_active: reservations.length,
    status_counts: statusCounts,
    matched,
    inserted,
    skipped_unmapped: skippedUnmapped,
    skipped_own: skippedOwn,
    unmapped_room_ids: [...new Set(unmappedRoomIds)].slice(0, 20),
    errors: errors.slice(0, 20),
  }));

  return {
    success: true,
    fetched_total: allReservations.length,
    fetched_active: reservations.length,
    status_counts: statusCounts,
    matched,
    inserted,
    skipped_unmapped: skippedUnmapped,
    skipped_own: skippedOwn,
    unmapped_room_ids: [...new Set(unmappedRoomIds)].slice(0, 20),
    errors: errors.slice(0, 20),
  };
}
