import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudbedsApiError, getCloudbedsReservationTotals, getCloudbedsRooms, kredensialCloudbeds, periksaKunciEl, type CloudbedsRoom, type HasilPeriksaKunci } from "@/lib/cloudbedsApi";
import { mapSourceNameToSumber } from "@/lib/cloudbedsSourceMapping";
import { statusSetelahSync } from "@/lib/bookingStatusSync";
import {
  elDibuatDiSini,
  jumlahMalam,
  pecahNama,
  pilihKamarEl,
  statusElDariCloudbeds,
  sumberEl,
  type PemakaianKamar,
} from "@/lib/elCloudbedsLogic";

/**
 * Sinkron dua arah Cloudbeds akun Loonars Excellent Living, padanan
 * Private Living:
 *  - TARIK  = syncCloudbedsReservations (cloudbedsReservationSync.ts):
 *    reservasi aktif Cloudbeds -> el_bookings (upsert per
 *    cloudbeds_reservation_id), pembatalan Cloudbeds -> 'batal'.
 *  - KIRIM  = pushBookingToCloudbeds (villa-api): booking EL yang dibuat di
 *    front desk/website -> postReservation, supaya kamarnya tertutup di OTA.
 *
 * Aturan yang sama dengan Private Living:
 *  - Booking yang lahir di sini (dibuat_oleh != 'cloudbeds') tidak pernah
 *    ditimpa salinan Cloudbeds -- postReservation tidak membawa harga.
 *  - Check-in/check-out dari meja depan tidak ditarik mundur (statusSetelahSync).
 *  - Satu reservasi = satu kamar (kamar pertama yang dipetakan).
 *  - Reservasi tanpa nomor kamar / kamarnya bentrok -> kamar kosong setipe.
 *  - Tidak mengirim WA dan tidak mendorong harga apa pun ke Cloudbeds.
 * Dipakai cron /api/cron/sync-cloudbeds-el (pg_cron tiap 10 menit) dan
 * tombol admin /api/admin/cloudbeds-el/sync.
 */

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";
const STATUS_AKTIF = ["not_confirmed", "confirmed", "checked_in"];
const STATUS_LOKAL_AKTIF = ["terjadwal", "checkin"];

interface KamarResv { roomID?: string | null; roomTypeID?: string | null; roomCheckIn?: string; roomCheckOut?: string; guestID?: string }
interface TamuResv { guestFirstName?: string | null; guestLastName?: string | null; guestPhone?: string | null; guestCellPhone?: string | null }
interface ReservasiCb {
  reservationID: string;
  status: string;
  guestName?: string;
  startDate: string;
  endDate: string;
  rooms?: KamarResv[];
  guestList?: Record<string, TamuResv>;
  sourceName?: string | null;
}

export interface ElSyncRingkasan {
  /** Kunci EL yang diterima Cloudbeds + hasil uji tiap env (tanpa isi kunci). */
  kunci: { terpilih: string | null; hasil: HasilPeriksaKunci[] };
  tarik: {
    diambil: number;
    aktif: number;
    disimpan: number;
    dipindah_kamar: { reservation_id: string; kamar: string | null }[];
    tanpa_kamar: string[];
    dilewati_milik_sendiri: number;
    dilewati_tipe_belum_dipetakan: number;
    dibatalkan: number;
  };
  kirim: { dicoba: number; berhasil: number; gagal: { booking_id: string; error: string }[] };
  errors: string[];
}

async function ambilReservasi(apiKey: string, propertyId: string, dariTanggal: string): Promise<ReservasiCb[]> {
  const semua: ReservasiCb[] = [];
  for (let halaman = 1; halaman <= 50; halaman++) {
    const url = new URL(`${CLOUDBEDS_API_BASE}/getReservations`);
    if (propertyId) url.searchParams.set("propertyID", propertyId);
    url.searchParams.set("checkOutFrom", dariTanggal);
    url.searchParams.set("includeAllRooms", "true");
    url.searchParams.set("includeGuestsDetails", "true");
    url.searchParams.set("pageNumber", String(halaman));
    url.searchParams.set("pageSize", "100");
    const res = await fetch(url, { headers: { "x-api-key": apiKey }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success === false) {
      throw new Error(body?.message || body?.error || `Cloudbeds getReservations error (HTTP ${res.status})`);
    }
    const rows = (body?.data ?? []) as ReservasiCb[];
    semua.push(...rows);
    if (rows.length < 100) break;
  }
  return semua;
}

function hariIniWib(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

async function catat(supabase: SupabaseClient, row: { reservation_id: string | null; event_type: string; payload: Record<string, unknown>; matched: boolean; error: string | null }) {
  await supabase.from("el_cloudbeds_events_log").insert(row);
}

/** Dilempar bila tidak satu pun kunci EL diterima Cloudbeds; membawa hasil uji kunci. */
export class KunciElDitolak extends CloudbedsApiError {
  constructor(public periksa: { terpilih: string | null; hasil: HasilPeriksaKunci[] }) {
    super(
      periksa.hasil.length
        ? "Cloudbeds menolak semua kunci Excellent Living (lihat 'kunci')"
        : "Kunci Cloudbeds Excellent Living belum diisi (CLOUDBEDS_API_KEY_LOONARS2)",
      periksa.hasil.length ? 401 : 503,
    );
  }
}

export async function syncCloudbedsEl(supabase: SupabaseClient): Promise<ElSyncRingkasan> {
  const periksa = await periksaKunciEl();
  if (!periksa.terpilih) throw new KunciElDitolak(periksa);
  const { apiKey, propertyId } = kredensialCloudbeds("el");
  const hariIni = hariIniWib();
  const errors: string[] = [];
  const ringkasan: ElSyncRingkasan = {
    kunci: periksa,
    tarik: { diambil: 0, aktif: 0, disimpan: 0, dipindah_kamar: [], tanpa_kamar: [], dilewati_milik_sendiri: 0, dilewati_tipe_belum_dipetakan: 0, dibatalkan: 0 },
    kirim: { dicoba: 0, berhasil: 0, gagal: [] },
    errors,
  };

  // Room Cloudbeds (roomID -> roomTypeID) dan pemetaan ke kamar EL.
  const roomsCb: CloudbedsRoom[] = await getCloudbedsRooms("el");
  const tipeDariRoomCb = new Map(roomsCb.map((r) => [String(r.roomID), r.roomTypeID ? String(r.roomTypeID) : null]));
  const { data: mappings, error: mapErr } = await supabase.from("el_cloudbeds_room_mapping").select("cloudbeds_room_id, room_id, el_rooms(nomor, active)");
  if (mapErr) throw new Error(`pemetaan room tidak terbaca: ${mapErr.message}`);
  type Peta = { cloudbeds_room_id: string; room_id: string; el_rooms: { nomor: string; active: boolean } | { nomor: string; active: boolean }[] | null };
  const peta = ((mappings ?? []) as unknown as Peta[]).map((m) => {
    const r = Array.isArray(m.el_rooms) ? m.el_rooms[0] : m.el_rooms;
    return { cbRoomId: String(m.cloudbeds_room_id), roomId: m.room_id, nomor: r?.nomor ?? null, active: r?.active !== false };
  });
  const kamarDariRoomCb = new Map(peta.filter((p) => p.active).map((p) => [p.cbRoomId, p.roomId]));
  const roomCbDariKamar = new Map(peta.map((p) => [p.roomId, p.cbRoomId]));
  const nomorKamar = new Map(peta.map((p) => [p.roomId, p.nomor]));
  const kandidatPerTipe = new Map<string, string[]>();
  for (const p of peta) {
    if (!p.active) continue;
    const tipe = tipeDariRoomCb.get(p.cbRoomId);
    if (!tipe) continue;
    kandidatPerTipe.set(tipe, [...(kandidatPerTipe.get(tipe) ?? []), p.roomId]);
  }

  // ── TARIK ─────────────────────────────────────────────────────────────
  const semua = await ambilReservasi(apiKey, propertyId, hariIni);
  const aktif = semua.filter((r) => STATUS_AKTIF.includes(r.status));
  ringkasan.tarik.diambil = semua.length;
  ringkasan.tarik.aktif = aktif.length;

  let total = new Map<string, { grandTotal: number }>();
  try {
    total = await getCloudbedsReservationTotals({ checkOutFrom: hariIni }, "el");
  } catch {
    // total kosong tidak boleh menghalangi booking tercatat
  }

  const ids = semua.map((r) => r.reservationID);
  const lokal = new Map<string, { id: string; status: string; room_id: string | null; dibuat_oleh: string | null }>();
  if (ids.length) {
    const { data } = await supabase.from("el_bookings").select("id, status, room_id, dibuat_oleh, cloudbeds_reservation_id").in("cloudbeds_reservation_id", ids);
    for (const b of data ?? []) lokal.set(String(b.cloudbeds_reservation_id), b as never);
  }

  const { data: aktifLokal } = await supabase
    .from("el_bookings")
    .select("room_id, tgl_checkin, tgl_checkout, cloudbeds_reservation_id")
    .in("status", STATUS_LOKAL_AKTIF)
    .gte("tgl_checkout", hariIni)
    .not("room_id", "is", null);
  const terpakai: PemakaianKamar[] = (aktifLokal ?? []).map((b) => ({
    roomId: String(b.room_id),
    checkIn: String(b.tgl_checkin),
    checkOut: String(b.tgl_checkout),
    reservationId: b.cloudbeds_reservation_id ? String(b.cloudbeds_reservation_id) : null,
  }));

  for (const r of aktif) {
    const ada = lokal.get(r.reservationID);
    if (ada && elDibuatDiSini(ada.dibuat_oleh)) {
      ringkasan.tarik.dilewati_milik_sendiri++;
      continue;
    }
    const rooms = r.rooms ?? [];
    const kamarBerpeta = rooms.find((x) => x.roomID && kamarDariRoomCb.has(String(x.roomID)));
    const kamarCb = kamarBerpeta ?? rooms.find((x) => x.roomTypeID) ?? rooms[0];
    const tipe = kamarCb?.roomTypeID ? String(kamarCb.roomTypeID) : kamarCb?.roomID ? (tipeDariRoomCb.get(String(kamarCb.roomID)) ?? null) : null;
    const checkIn = kamarCb?.roomCheckIn ?? r.startDate;
    const checkOut = kamarCb?.roomCheckOut ?? r.endDate;
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      errors.push(`${r.reservationID}: tanggal tidak valid`);
      continue;
    }
    const kandidat = tipe ? (kandidatPerTipe.get(tipe) ?? []) : [];
    if (!kamarBerpeta && kandidat.length === 0) {
      ringkasan.tarik.dilewati_tipe_belum_dipetakan++;
      continue;
    }

    // Tamu yang sudah check-in/out tetap di kamar tempat ia berada.
    const terkunci = ada && (ada.status === "checkin" || ada.status === "checkout") ? ada.room_id : null;
    const pilihan = terkunci
      ? { roomId: terkunci, pindah: false }
      : pilihKamarEl({
          kamarCloudbeds: kamarBerpeta?.roomID ? kamarDariRoomCb.get(String(kamarBerpeta.roomID))! : null,
          kandidatSetipe: kandidat,
          kamarSebelumnya: ada?.room_id ?? null,
          checkIn,
          checkOut,
          terpakai,
          reservationId: r.reservationID,
        });

    const tamu = kamarCb?.guestID ? r.guestList?.[kamarCb.guestID] : undefined;
    const nama = tamu?.guestFirstName || tamu?.guestLastName ? `${tamu?.guestFirstName ?? ""} ${tamu?.guestLastName ?? ""}`.trim() : (r.guestName ?? "Tamu Cloudbeds");
    const hp = tamu?.guestPhone || tamu?.guestCellPhone || null;
    const grand = total.get(r.reservationID)?.grandTotal ?? 0;

    const isi: Record<string, unknown> = {
      room_id: pilihan?.roomId ?? null,
      room_nomor: pilihan ? (nomorKamar.get(pilihan.roomId) ?? null) : null,
      guest_nama: nama,
      sumber: sumberEl(mapSourceNameToSumber(r.sourceName)),
      tgl_checkin: checkIn,
      tgl_checkout: checkOut,
      durasi_malam: jumlahMalam(checkIn, checkOut),
      status: statusSetelahSync(ada?.status, statusElDariCloudbeds(r.status)),
      cloudbeds_reservation_id: r.reservationID,
      dibuat_oleh: "cloudbeds",
      updated_at: new Date().toISOString(),
    };
    // Nomor dari check-in resepsionis tidak ditimpa; total 0 (gagal dibaca) tidak menimpa total lama.
    if (hp && !ada) isi.guest_hp = hp;
    if (grand > 0 || !ada) isi.total_bayar = grand;

    const { error } = await supabase.from("el_bookings").upsert(isi, { onConflict: "cloudbeds_reservation_id" });
    if (error) {
      errors.push(`${r.reservationID}: ${error.message}`);
      continue;
    }
    ringkasan.tarik.disimpan++;
    if (pilihan) {
      terpakai.push({ roomId: pilihan.roomId, checkIn, checkOut, reservationId: r.reservationID });
      if (pilihan.pindah || (!kamarBerpeta && ada?.room_id !== pilihan.roomId)) {
        ringkasan.tarik.dipindah_kamar.push({ reservation_id: r.reservationID, kamar: nomorKamar.get(pilihan.roomId) ?? null });
      }
    } else {
      ringkasan.tarik.tanpa_kamar.push(r.reservationID);
      await catat(supabase, {
        reservation_id: r.reservationID,
        event_type: "sync.tanpa_kamar",
        payload: { guest_nama: nama, tgl_checkin: checkIn, tgl_checkout: checkOut },
        matched: false,
        error: "tidak_ada_kamar_kosong_setipe (kemungkinan overbooking)",
      });
    }
  }

  // Pembatalan di Cloudbeds -> 'batal' (hanya yang belum check-in).
  const batalIds = semua.filter((r) => r.status === "canceled").map((r) => r.reservationID);
  if (batalIds.length) {
    const { data: tutup } = await supabase.from("el_bookings").select("id, dibuat_oleh").in("cloudbeds_reservation_id", batalIds).eq("status", "terjadwal");
    for (const b of tutup ?? []) {
      const { error } = await supabase.from("el_bookings").update({ status: "batal", updated_at: new Date().toISOString() }).eq("id", b.id).eq("status", "terjadwal");
      if (error) errors.push(`batal ${b.id}: ${error.message}`);
      else ringkasan.tarik.dibatalkan++;
    }
  }

  // ── KIRIM ─────────────────────────────────────────────────────────────
  const { data: belum } = await supabase
    .from("el_bookings")
    .select("id, room_id, guest_nama, guest_hp, tgl_checkin, tgl_checkout, adults, children, dibuat_oleh")
    .is("cloudbeds_reservation_id", null)
    .in("status", STATUS_LOKAL_AKTIF)
    .gte("tgl_checkout", hariIni)
    .not("room_id", "is", null)
    .limit(20);
  const antre = (belum ?? []).filter((b) => elDibuatDiSini(b.dibuat_oleh));
  if (antre.length) {
    const sourceId = await sumberLangsung(apiKey, propertyId);
    for (const b of antre) {
      ringkasan.kirim.dicoba++;
      const hasil = sourceId
        ? await kirimSatu(apiKey, propertyId, sourceId, b, roomCbDariKamar, tipeDariRoomCb)
        : { error: "sumber_langsung_tidak_ditemukan (getSources)" };
      if ("reservationID" in hasil) {
        // Hanya ditulis bila masih kosong: dua run bersamaan tidak saling menimpa.
        await supabase.from("el_bookings").update({ cloudbeds_reservation_id: hasil.reservationID, updated_at: new Date().toISOString() }).eq("id", b.id).is("cloudbeds_reservation_id", null);
        ringkasan.kirim.berhasil++;
        await catat(supabase, { reservation_id: hasil.reservationID, event_type: "outbound.reservation.created", payload: { booking_id: b.id, room_id: b.room_id, variant: hasil.variant }, matched: true, error: null });
      } else {
        ringkasan.kirim.gagal.push({ booking_id: b.id, error: hasil.error });
        await catat(supabase, { reservation_id: null, event_type: "outbound.reservation.created", payload: { booking_id: b.id, room_id: b.room_id, attempts: hasil.attempts ?? null }, matched: false, error: hasil.error });
      }
    }
  }

  const adaPerubahan = ringkasan.tarik.disimpan > 0 || ringkasan.tarik.dibatalkan > 0 || ringkasan.kirim.dicoba > 0 || errors.length > 0;
  console.log("[el-cloudbeds-sync]", JSON.stringify(ringkasan));
  if (adaPerubahan && errors.length) {
    await catat(supabase, { reservation_id: null, event_type: "sync.ringkasan", payload: ringkasan as unknown as Record<string, unknown>, matched: false, error: errors.slice(0, 5).join(" | ") });
  }
  return ringkasan;
}

/** Sumber "Website/Booking Engine" (atau sumber langsung lain) di akun EL, sama dengan villa-api. */
async function sumberLangsung(apiKey: string, propertyId: string): Promise<string | null> {
  const url = new URL(`${CLOUDBEDS_API_BASE}/getSources`);
  if (propertyId) url.searchParams.set("propertyID", propertyId);
  const res = await fetch(url, { headers: { "x-api-key": apiKey }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  let rows: Array<Record<string, unknown>> = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
  if (rows.length && Array.isArray(rows[0])) rows = (rows as unknown as Array<Array<Record<string, unknown>>>).flat();
  const falsy = (v: unknown) => v === false || v === 0 || v === "0" || v === "false";
  const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
  const nama = (x: Record<string, unknown>) => String(x.sourceName ?? "");
  const pilih =
    rows.find((x) => /website|booking\s*engine/i.test(nama(x)) && falsy(x.isThirdParty) && truthy(x.status)) ??
    rows.find((x) => falsy(x.isThirdParty) && truthy(x.status)) ??
    rows.find((x) => falsy(x.isThirdParty)) ??
    rows.find((x) => truthy(x.status) && /website|direct|walk|phone|front\s*desk/i.test(nama(x)));
  return pilih?.sourceID ? String(pilih.sourceID) : null;
}

type BookingKirim = { id: string; room_id: string | null; guest_nama: string | null; guest_hp: string | null; tgl_checkin: string; tgl_checkout: string; adults: number | null; children: number | null };

async function kirimSatu(
  apiKey: string,
  propertyId: string,
  sourceId: string,
  b: BookingKirim,
  roomCbDariKamar: Map<string, string>,
  tipeDariRoomCb: Map<string, string | null>,
): Promise<{ reservationID: string; variant: string } | { error: string; attempts?: unknown[] }> {
  const cbRoomId = b.room_id ? roomCbDariKamar.get(b.room_id) : undefined;
  if (!cbRoomId) return { error: "kamar_belum_dipetakan_ke_cloudbeds" };
  const tipe = tipeDariRoomCb.get(cbRoomId);
  if (!tipe) return { error: "room_cloudbeds_tidak_ada_di_getRooms" };
  const { first, last } = pecahNama(b.guest_nama);
  const dewasa = Math.max(1, Math.trunc(Number(b.adults ?? 1)) || 1);
  const anak = Math.max(0, Math.trunc(Number(b.children ?? 0)) || 0);
  const dasar = (d = dewasa, a: number | null = anak) => {
    const f = new URLSearchParams();
    if (propertyId) f.set("propertyID", propertyId);
    f.set("sourceID", sourceId);
    f.set("startDate", b.tgl_checkin);
    f.set("endDate", b.tgl_checkout);
    f.set("guestFirstName", first);
    f.set("guestLastName", last);
    f.set("guestCountry", "ID");
    f.set("guestZip", "55581");
    // Cloudbeds wajib email; el_bookings tidak menyimpannya. Alamat cadangan
    // yang sama polanya dengan villa-api, tidak pernah dikirimi surat.
    f.set("guestEmail", `el-${String(b.id).slice(0, 8)}@guest.loonars.id`);
    if (b.guest_hp) f.set("guestPhone", b.guest_hp);
    f.set("rooms[0][roomTypeID]", tipe);
    f.set("rooms[0][quantity]", "1");
    f.set("adults[0][roomTypeID]", tipe);
    f.set("adults[0][quantity]", String(d));
    if (a !== null) {
      f.set("children[0][roomTypeID]", tipe);
      f.set("children[0][quantity]", String(a));
    } else f.set("children", "");
    f.set("paymentMethod", "cash");
    f.set("sendEmailConfirmation", "false");
    return f;
  };
  const varian: Array<{ nama: string; form: () => URLSearchParams }> = [
    { nama: "room_type_only", form: () => dasar() },
    { nama: "with_roomID", form: () => { const f = dasar(); f.set("rooms[0][roomID]", cbRoomId); return f; } },
    { nama: "no_children_row", form: () => dasar(dewasa, null) },
    { nama: "occupancy_fallback_1_0", form: () => dasar(1, 0) },
  ];
  const attempts: unknown[] = [];
  for (const v of varian) {
    const res = await fetch(`${CLOUDBEDS_API_BASE}/postReservation`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: v.form().toString(),
    });
    const body = await res.json().catch(() => null);
    attempts.push({ variant: v.nama, http: res.status, success: body?.success ?? null, message: body?.message ?? null });
    if (res.ok && body?.success !== false && body?.reservationID) return { reservationID: String(body.reservationID), variant: v.nama };
  }
  return { error: "postReservation_failed_all_variants", attempts };
}
