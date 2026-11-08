import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CloudbedsApiError,
  diagnosaGetRooms,
  type DiagnosaGetRooms,
  getCloudbedsReservationTotals,
  getCloudbedsRoomBlocks,
  getCloudbedsRooms,
  kredensialCloudbeds,
  type CloudbedsRoom,
  type HasilPeriksaKunci,
} from "@/lib/cloudbedsApi";
import { mapSourceNameToSumber } from "@/lib/cloudbedsSourceMapping";
import { statusSetelahSync } from "@/lib/bookingStatusSync";
import { bacaBlokirKamar } from "@/lib/cloudbedsUnitSementara";
import { buatKodeTipe, jumlahMalam, kamarUntukNamaBerurut, normalNama, pecahNama, PENANDA_BLOK, pilihKamarEl, statusElDariCloudbeds, tarifDikunciLokal, type PemakaianKamar } from "@/lib/elCloudbedsLogic";
import { supabaseAdminProperti } from "@/lib/supabaseAdmin";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";

/**
 * Sinkron dua arah Cloudbeds akun Loonars Excellent Living -- versi tabel
 * BERSAMA (multi-properti, owner 2026-11-04: "Sinkronkan dan nyalakan").
 * Data EL ada di units / villa_room_types / bookings / cloudbeds_room_mapping
 * dengan property_kode 'EL' (klien supabaseAdminProperti('EL') menyaring dan
 * mengisi kolom itu otomatis). Tabel el_* lama tidak lagi ditulis.
 *
 *  - KAMAR: Cloudbeds EL hanya punya 1 room per tipe; 31 kamar fisik diatur
 *    di sistem (owner: "kamar hanya ada 31"). Sinkron TIDAK membuat kamar.
 *    Tipe Cloudbeds baru -> villa_room_types EL. Room Cloudbeds yang belum
 *    dipetakan dicocokkan ke unit bernomor sama; kalau tidak ada, dicatat.
 *    Blokir hari ini -> 'maintenance' + penanda [Blok Cloudbeds]; dibuka ->
 *    'available' (maintenance manual tanpa penanda tidak disentuh).
 *  - TARIK: reservasi aktif -> bookings EL (upsert per cloudbeds_reservation_id),
 *    kamar = room Cloudbeds yang dipetakan, atau kamar kosong setipe (kamar
 *    yang sudah dibuka manager didahulukan). Tidak ada kamar kosong ->
 *    tidak disimpan (bookings.unit_id wajib), dicatat sebagai overbooking.
 *    Pembatalan -> 'batal'. Check-in/out meja depan tidak ditarik mundur.
 *  - KIRIM: booking EL front desk (catatan "[Front Desk EL]") tanpa
 *    cloudbeds_reservation_id -> postReservation tanpa harga.
 * Tidak mengirim WA dan tidak mendorong harga ke Cloudbeds.
 */

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";
const STATUS_AKTIF = ["not_confirmed", "confirmed", "checked_in"];
const STATUS_LOKAL_AKTIF = ["terjadwal", "checkin"];
export const PENANDA_FRONT_DESK_EL = "[Front Desk EL]";
/** Penanda booking front desk / website untuk properti mana pun: "[Front Desk XX]" / "[Website XX]". */
export const penandaFrontDesk = (kode: string) => `[Front Desk ${kode.toUpperCase()}]`;
export const penandaWebsite = (kode: string) => `[Website ${kode.toUpperCase()}]`;
/** Booking online dari loonars.id (villa-api /public/el/bookings); ikut dikirim ke Cloudbeds EL setelah lunas. */
export const PENANDA_WEBSITE_EL = "[Website EL]";
const SUMBER_BOOKINGS = ["walk-in", "airbnb", "tiket", "agoda", "booking.com", "website", "whatsapp", "other", "cloudbeds", "traveloka", "google"];

interface KamarResv { roomID?: string | null; roomTypeID?: string | null; roomCheckIn?: string; roomCheckOut?: string; guestID?: string }
interface TamuResv { guestFirstName?: string | null; guestLastName?: string | null; guestPhone?: string | null; guestCellPhone?: string | null; guestEmail?: string | null }
interface ReservasiCb {
  reservationID: string;
  status: string;
  guestName?: string;
  guestEmail?: string | null;
  startDate: string;
  endDate: string;
  rooms?: KamarResv[];
  guestList?: Record<string, TamuResv>;
  sourceName?: string | null;
}

export interface RingkasanKamar {
  room_cloudbeds: number;
  tipe_dibuat: string[];
  kamar_dibuat: string[];
  dipetakan: number;
  diubah: number;
  dinonaktifkan: string[];
  tetap_aktif_ada_booking: string[];
  diblokir_hari_ini: string[];
  room_belum_dipetakan: string[];
  cloudbeds?: (DiagnosaGetRooms & { per_tipe: Record<string, number> }) | null;
}

export interface ElSyncRingkasan {
  kamar: RingkasanKamar;
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

/** Dilempar bila tidak satu pun kunci properti diterima Cloudbeds; membawa hasil uji kunci. */
export class KunciElDitolak extends CloudbedsApiError {
  constructor(public periksa: { terpilih: string | null; hasil: HasilPeriksaKunci[] }) {
    super(
      periksa.hasil.length ? "Cloudbeds menolak semua kunci Excellent Living (lihat 'kunci')" : "Kunci Cloudbeds Excellent Living belum diisi (CLOUDBEDS_API_KEY_LOONARS2)",
      periksa.hasil.length ? 401 : 503,
    );
  }
}

function hariIniWib(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

/** Booking EL yang lahir di front desk (bukan salinan Cloudbeds). */
export function bookingElMilikSendiri(catatan: string | null | undefined): boolean {
  return /\[(Front Desk|Website) [A-Z]{2,6}\]/.test(String(catatan ?? ""));
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
    if (!res.ok || body?.success === false) throw new Error(body?.message || body?.error || `Cloudbeds getReservations error (HTTP ${res.status})`);
    const rows = (body?.data ?? []) as ReservasiCb[];
    semua.push(...rows);
    if (rows.length < 100) break;
  }
  return semua;
}

type Log = SupabaseClient;
async function catat(log: Log, row: { reservation_id: string | null; event_type: string; payload: Record<string, unknown>; matched: boolean; error: string | null }) {
  await log.from("el_cloudbeds_events_log").insert(row);
}

/** Sinkron Excellent Living (kode lama; kini hanya pembungkus properti 'EL'). */
export function syncCloudbedsEl(): Promise<ElSyncRingkasan> {
  return syncCloudbedsProperti("EL");
}

/**
 * Sinkron dua arah Cloudbeds untuk SATU properti non-PL (kunci dari
 * properti_<kode> di database, atau env lama untuk EL). Properti yang belum
 * punya kamar sama sekali: kamar dibuat otomatis dari room Cloudbeds
 * (status maintenance sampai manager membukanya).
 */
export async function syncCloudbedsProperti(kodeProperti: string): Promise<ElSyncRingkasan> {
  const kode = kodeProperti.trim().toUpperCase();
  if (kode === "PL") throw new Error("Sinkron properti ini tidak untuk Private Living");
  const { akun, periksa } = await siapkanAkunCloudbeds(kode);
  const { apiKey, propertyId } = kredensialCloudbeds(akun);
  const db = supabaseAdminProperti(kode);
  const hariIni = hariIniWib();
  const errors: string[] = [];
  const ringkasan: ElSyncRingkasan = {
    kunci: periksa,
    kamar: { room_cloudbeds: 0, tipe_dibuat: [], kamar_dibuat: [], dipetakan: 0, diubah: 0, dinonaktifkan: [], tetap_aktif_ada_booking: [], diblokir_hari_ini: [], room_belum_dipetakan: [] },
    tarik: { diambil: 0, aktif: 0, disimpan: 0, dipindah_kamar: [], tanpa_kamar: [], dilewati_milik_sendiri: 0, dilewati_tipe_belum_dipetakan: 0, dibatalkan: 0 },
    kirim: { dicoba: 0, berhasil: 0, gagal: [] },
    errors,
  };

  const roomsCb: CloudbedsRoom[] = await getCloudbedsRooms(akun);
  const { count: jumlahKamarAwal } = await db.from("units").select("id", { count: "exact", head: true });
  ringkasan.kamar = await sinkronKamarEl(db, roomsCb, errors, { akun, kode, buatKamar: (jumlahKamarAwal ?? 0) === 0 });
  const tipeDariRoomCb = new Map(roomsCb.map((r) => [String(r.roomID), r.roomTypeID ? String(r.roomTypeID) : null]));

  const [{ data: peta, error: e1 }, { data: unitRows, error: e2 }] = await Promise.all([
    db.from("cloudbeds_room_mapping").select("cloudbeds_room_id, unit_id"),
    db.from("units").select("id, nomor, room_type_id, status").order("nomor"),
  ]);
  if (e1 || e2) throw new Error(`data kamar ${kode} tidak terbaca: ${(e1 ?? e2)!.message}`);
  const kamar = (unitRows ?? []) as { id: string; nomor: string; room_type_id: string | null; status: string }[];
  const nomorKamar = new Map(kamar.map((k) => [k.id, k.nomor]));
  const tipeLokalDariKamar = new Map(kamar.map((k) => [k.id, k.room_type_id]));
  const kamarDariRoomCb = new Map((peta ?? []).filter((p) => nomorKamar.has(String(p.unit_id))).map((p) => [String(p.cloudbeds_room_id), String(p.unit_id)]));
  const roomCbDariKamar = new Map([...kamarDariRoomCb].map(([cb, u]) => [u, cb]));
  const tipeLokalDariTipeCb = new Map<string, string>();
  for (const [cbRoom, unitId] of kamarDariRoomCb) {
    const cb = tipeDariRoomCb.get(cbRoom);
    const lokal = tipeLokalDariKamar.get(unitId);
    if (cb && lokal && !tipeLokalDariTipeCb.has(cb)) tipeLokalDariTipeCb.set(cb, lokal);
  }
  const tipeCbDariTipeLokal = new Map([...tipeLokalDariTipeCb].map(([cb, lokal]) => [lokal, cb]));
  const kandidatPerTipe = new Map<string, string[]>();
  for (const [cb, lokal] of tipeLokalDariTipeCb) {
    const setipe = kamar.filter((k) => k.room_type_id === lokal);
    kandidatPerTipe.set(cb, [...setipe.filter((k) => k.status !== "maintenance"), ...setipe.filter((k) => k.status === "maintenance")].map((k) => k.id));
  }

  // ── TARIK ─────────────────────────────────────────────────────────────
  const semua = await ambilReservasi(apiKey, propertyId, hariIni);
  const aktif = semua.filter((r) => STATUS_AKTIF.includes(r.status));
  ringkasan.tarik.diambil = semua.length;
  ringkasan.tarik.aktif = aktif.length;

  let total = new Map<string, { grandTotal: number; subTotal: number }>();
  try {
    total = await getCloudbedsReservationTotals({ checkOutFrom: hariIni }, akun);
  } catch {
    // total kosong tidak boleh menghalangi booking tercatat
  }

  const ids = semua.map((r) => r.reservationID);
  const lokal = new Map<string, { id: string; status: string; unit_id: string | null; catatan: string | null; guest_id: string | null }>();
  if (ids.length) {
    const { data } = await db.from("bookings").select("id, status, unit_id, catatan, guest_id, cloudbeds_reservation_id").in("cloudbeds_reservation_id", ids);
    for (const b of data ?? []) lokal.set(String(b.cloudbeds_reservation_id), b as never);
  }

  const { data: aktifLokal } = await db
    .from("bookings")
    .select("unit_id, tgl_checkin, tgl_checkout, cloudbeds_reservation_id")
    .in("status", STATUS_LOKAL_AKTIF)
    .gte("tgl_checkout", hariIni);
  const terpakai: PemakaianKamar[] = (aktifLokal ?? []).map((b) => ({
    roomId: String(b.unit_id),
    checkIn: String(b.tgl_checkin),
    checkOut: String(b.tgl_checkout ?? "9999-12-31"),
    reservationId: b.cloudbeds_reservation_id ? String(b.cloudbeds_reservation_id) : null,
  }));
  try {
    const sampai = new Date(Date.parse(`${hariIni}T00:00:00Z`) + 34 * 86400000).toISOString().slice(0, 10);
    for (const blk of bacaBlokirKamar(await getCloudbedsRoomBlocks(hariIni, sampai, akun))) {
      for (const cb of blk.roomIds) {
        const unitId = kamarDariRoomCb.get(cb);
        if (unitId) terpakai.push({ roomId: unitId, checkIn: blk.startDate, checkOut: blk.endDate ?? "9999-12-31", reservationId: "blok-cloudbeds" });
      }
    }
  } catch (e) {
    errors.push(`blokir kamar tidak terbaca: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const r of aktif) {
    const ada = lokal.get(r.reservationID);
    if (ada && bookingElMilikSendiri(ada.catatan)) {
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
    const terkunci = ada && (ada.status === "checkin" || ada.status === "checkout") ? ada.unit_id : null;
    const pilihan = terkunci
      ? { roomId: terkunci, pindah: false }
      : pilihKamarEl({
          kamarCloudbeds: kamarBerpeta?.roomID ? kamarDariRoomCb.get(String(kamarBerpeta.roomID))! : null,
          kandidatSetipe: kandidat,
          kamarSebelumnya: ada?.unit_id ?? null,
          checkIn,
          checkOut,
          terpakai,
          reservationId: r.reservationID,
        });
    const tamu = kamarCb?.guestID ? r.guestList?.[kamarCb.guestID] : undefined;
    const nama = tamu?.guestFirstName || tamu?.guestLastName ? `${tamu?.guestFirstName ?? ""} ${tamu?.guestLastName ?? ""}`.trim() : (r.guestName ?? "Tamu Cloudbeds");
    if (!pilihan) {
      ringkasan.tarik.tanpa_kamar.push(r.reservationID);
      await catat(db, {
        reservation_id: r.reservationID,
        event_type: "sync.tanpa_kamar",
        payload: { guest_nama: nama, tgl_checkin: checkIn, tgl_checkout: checkOut },
        matched: false,
        error: "tidak_ada_kamar_kosong_setipe (kemungkinan overbooking)",
      });
      continue;
    }

    // Tamu: yang sudah tertaut dipakai ulang; reservasi baru dicari lewat nomor/email.
    const hp = tamu?.guestPhone || tamu?.guestCellPhone || null;
    const email = (tamu?.guestEmail ?? r.guestEmail ?? "").includes("@") ? String(tamu?.guestEmail ?? r.guestEmail).trim() : null;
    let guestId = ada?.guest_id ?? null;
    try {
      if (!guestId && hp) guestId = (await db.from("guests").select("id").eq("hp", hp).limit(1).maybeSingle()).data?.id ?? null;
      if (!guestId && email) guestId = (await db.from("guests").select("id").eq("email", email).limit(1).maybeSingle()).data?.id ?? null;
      if (!guestId) guestId = (await db.from("guests").insert({ nama, hp, email }).select("id").single()).data?.id ?? null;
    } catch (e) {
      errors.push(`${r.reservationID}: tamu gagal dicatat (${e instanceof Error ? e.message : String(e)})`);
    }

    const t = total.get(r.reservationID);
    const sumber = mapSourceNameToSumber(r.sourceName);
    const isi: Record<string, unknown> = {
      unit_id: pilihan.roomId,
      unit_nomor: nomorKamar.get(pilihan.roomId) ?? "?",
      guest_id: guestId,
      guest_nama: nama,
      tipe: "harian",
      sumber: SUMBER_BOOKINGS.includes(sumber) ? sumber : "cloudbeds",
      tgl_checkin: checkIn,
      tgl_checkout: checkOut,
      durasi_malam: jumlahMalam(checkIn, checkOut),
      status: statusSetelahSync(ada?.status, statusElDariCloudbeds(r.status)),
      cloudbeds_reservation_id: r.reservationID,
      updated_at: new Date().toISOString(),
    };
    if (ada && tarifDikunciLokal(ada.catatan)) {
      // Kupon investor: tarif lokal = harga setelah diskon (yang dibayar
      // tamu); Cloudbeds tidak tahu diskonnya, jadi angkanya tidak dipakai.
    } else if (t && t.grandTotal > 0) {
      isi.tarif = t.grandTotal;
      isi.total_bayar = t.grandTotal;
      isi.cloudbeds_subtotal = t.subTotal;
    } else if (!ada) {
      isi.tarif = 0;
      isi.total_bayar = 0;
    }
    const { error } = await db.from("bookings").upsert(isi, { onConflict: "cloudbeds_reservation_id" });
    if (error) {
      errors.push(`${r.reservationID}: ${error.message}`);
      continue;
    }
    ringkasan.tarik.disimpan++;
    terpakai.push({ roomId: pilihan.roomId, checkIn, checkOut, reservationId: r.reservationID });
    if (pilihan.pindah || (!kamarBerpeta && ada?.unit_id !== pilihan.roomId)) {
      ringkasan.tarik.dipindah_kamar.push({ reservation_id: r.reservationID, kamar: nomorKamar.get(pilihan.roomId) ?? null });
    }
  }

  const batalIds = semua.filter((r) => r.status === "canceled").map((r) => r.reservationID);
  if (batalIds.length) {
    const { data: tutup } = await db.from("bookings").select("id").in("cloudbeds_reservation_id", batalIds).eq("status", "terjadwal");
    for (const b of tutup ?? []) {
      const { error } = await db.from("bookings").update({ status: "batal", updated_at: new Date().toISOString() }).eq("id", b.id).eq("status", "terjadwal");
      if (error) errors.push(`batal ${b.id}: ${error.message}`);
      else ringkasan.tarik.dibatalkan++;
    }
  }

  // ── KIRIM ─────────────────────────────────────────────────────────────
  const { data: belum } = await db
    .from("bookings")
    .select("id, unit_id, guest_nama, guest_id, tgl_checkin, tgl_checkout, adults, children, catatan")
    .is("cloudbeds_reservation_id", null)
    .in("status", STATUS_LOKAL_AKTIF)
    .gte("tgl_checkout", hariIni)
    .limit(20);
  const antre = (belum ?? []).filter((b) => bookingElMilikSendiri(b.catatan) && b.tgl_checkout);
  if (antre.length) {
    const sourceId = await sumberLangsung(apiKey, propertyId);
    for (const b of antre) {
      ringkasan.kirim.dicoba++;
      const tipeCb = b.unit_id ? tipeCbDariTipeLokal.get(String(tipeLokalDariKamar.get(String(b.unit_id)) ?? "")) : undefined;
      let hp: string | null = null;
      if (b.guest_id) hp = (await db.from("guests").select("hp").eq("id", b.guest_id).maybeSingle()).data?.hp ?? null;
      const hasil = !sourceId
        ? { error: "sumber_langsung_tidak_ditemukan (getSources)" }
        : !tipeCb
          ? { error: "tipe_kamar_belum_terhubung_ke_cloudbeds" }
          : await kirimSatu(apiKey, propertyId, sourceId, { ...b, tgl_checkout: String(b.tgl_checkout), guest_hp: hp }, tipeCb, roomCbDariKamar.get(String(b.unit_id)));
      if ("reservationID" in hasil) {
        await db.from("bookings").update({ cloudbeds_reservation_id: hasil.reservationID, updated_at: new Date().toISOString() }).eq("id", b.id).is("cloudbeds_reservation_id", null);
        ringkasan.kirim.berhasil++;
        await catat(db, { reservation_id: hasil.reservationID, event_type: "outbound.reservation.created", payload: { booking_id: b.id, unit_id: b.unit_id, variant: hasil.variant }, matched: true, error: null });
      } else {
        ringkasan.kirim.gagal.push({ booking_id: b.id, error: hasil.error });
        await catat(db, { reservation_id: null, event_type: "outbound.reservation.created", payload: { booking_id: b.id, unit_id: b.unit_id, attempts: "attempts" in hasil ? hasil.attempts ?? null : null }, matched: false, error: hasil.error });
      }
    }
  }

  console.log("[el-cloudbeds-sync]", JSON.stringify(ringkasan));
  if (errors.length) {
    await catat(db, { reservation_id: null, event_type: "sync.ringkasan", payload: ringkasan as unknown as Record<string, unknown>, matched: false, error: errors.slice(0, 5).join(" | ") });
  }
  return ringkasan;
}

/**
 * Tipe & status kamar EL dari Cloudbeds (tabel bersama). Tidak membuat
 * kamar: 31 kamar fisik diatur di sistem. Pengaman: getRooms kosong ->
 * tidak ada yang diubah.
 */
export async function sinkronKamarEl(
  db: SupabaseClient,
  roomsCb: CloudbedsRoom[],
  errors: string[],
  opsi: { akun?: string; kode?: string; buatKamar?: boolean } = {},
): Promise<RingkasanKamar> {
  const akun = opsi.akun ?? "el";
  const kodeProp = opsi.kode ?? "EL";
  const hasil: RingkasanKamar = { room_cloudbeds: 0, tipe_dibuat: [], kamar_dibuat: [], dipetakan: 0, diubah: 0, dinonaktifkan: [], tetap_aktif_ada_booking: [], diblokir_hari_ini: [], room_belum_dipetakan: [] };
  const nyata = roomsCb.filter((r) => !r.isVirtual && r.roomTypeID);
  hasil.room_cloudbeds = nyata.length;
  const perTipe: Record<string, number> = {};
  for (const r of roomsCb) {
    const k = `${r.roomTypeName ?? "?"}${r.isVirtual ? " (virtual)" : ""}`;
    perTipe[k] = (perTipe[k] ?? 0) + 1;
  }
  const diag = diagnosaGetRooms(akun);
  hasil.cloudbeds = diag ? { ...diag, per_tipe: perTipe } : null;
  hasil.diblokir_hari_ini = nyata.filter((r) => r.roomBlocked).map((r) => r.roomName);
  if (nyata.length === 0) {
    errors.push(`Cloudbeds tidak mengembalikan kamar; data kamar ${kodeProp} tidak diubah`);
    return hasil;
  }

  const [{ data: tipe }, { data: kamar }, { data: peta }, semuaKode] = await Promise.all([
    db.from("villa_room_types").select("id, code, name"),
    db.from("units").select("id, nomor, room_type_id, status, catatan"),
    db.from("cloudbeds_room_mapping").select("cloudbeds_room_id, unit_id"),
    // Kode tipe unik untuk SEMUA properti (constraint villa_room_types_code_key).
    supabaseAdminProperti("PL").from("villa_room_types").select("code"),
  ]);
  const kodeDipakai = new Set([...(tipe ?? []), ...(semuaKode.data ?? [])].map((t) => String(t.code).toUpperCase()));
  const kamarById = new Map((kamar ?? []).map((k) => [String(k.id), k]));
  const petaByCb = new Map((peta ?? []).map((p) => [String(p.cloudbeds_room_id), String(p.unit_id)]));

  // Tipe Cloudbeds -> villa_room_types EL (via kamar berpeta, nama, atau kode).
  const tipeSudah = new Set<string>();
  for (const r of nyata) {
    const unit = petaByCb.get(r.roomID);
    const k = unit ? kamarById.get(unit) : undefined;
    if (k?.room_type_id) tipeSudah.add(String(r.roomTypeID));
  }
  const dibuat = new Set<string>();
  for (const r of nyata) {
    const kunci = String(r.roomTypeID);
    if (tipeSudah.has(kunci) || dibuat.has(kunci)) continue;
    const ada = (tipe ?? []).find(
      (t) => normalNama(t.name) === normalNama(r.roomTypeName) || (r.roomTypeNameShort && String(t.code).toUpperCase() === r.roomTypeNameShort.trim().toUpperCase()),
    );
    dibuat.add(kunci);
    if (ada) continue;
    const nama = (r.roomTypeName ?? "Kamar").trim();
    const { error } = await db.from("villa_room_types").insert({ code: buatKodeTipe(nama, r.roomTypeNameShort, kodeDipakai), name: nama, active: true });
    if (error) errors.push(`tipe ${nama}: ${error.message}`);
    else hasil.tipe_dibuat.push(nama);
  }

  // Room Cloudbeds yang belum dipetakan: cocokkan ke unit bernomor sama.
  const sudahDipetakan = new Set(petaByCb.values());
  for (const r of nyata) {
    if (petaByCb.has(r.roomID)) continue;
    let sama = (kamar ?? []).find((k) => normalNama(k.nomor) === normalNama(r.roomName) && !sudahDipetakan.has(String(k.id)));
    if (!sama) {
      const berurut = kamarUntukNamaBerurut(r.roomName, r.roomTypeNameShort, tipe ?? [], kamar ?? []);
      if (berurut && !sudahDipetakan.has(String(berurut.id))) sama = berurut;
    }
    if (!sama && opsi.buatKamar) {
      // Properti baru tanpa kamar: buat unit dari room Cloudbeds (maintenance
      // sampai manager membukanya). Nomor kamar unik di seluruh sistem;
      // bentrok dengan properti lain -> diberi awalan kode properti.
      const tipeLokal = (await db.from("villa_room_types").select("id, code, name")).data ?? [];
      const jenis = tipeLokal.find(
        (t) => normalNama(t.name) === normalNama(r.roomTypeName) || (r.roomTypeNameShort && String(t.code).toUpperCase() === r.roomTypeNameShort.trim().toUpperCase()),
      );
      if (jenis) {
        for (const nomor of [r.roomName, `${kodeProp}-${r.roomName}`]) {
          const { data: baru, error } = await db
            .from("units")
            .insert({ nomor, blok: String(jenis.code), status: "maintenance", room_type_id: jenis.id, catatan: null })
            .select("id, nomor, room_type_id, status, catatan")
            .single();
          if (!error && baru) {
            sama = baru as NonNullable<typeof sama>;
            (kamar ?? []).push(baru as (typeof kamar extends (infer U)[] | null ? U : never));
            hasil.kamar_dibuat.push(nomor);
            break;
          }
          if (error?.code !== "23505") {
            errors.push(`kamar ${r.roomName}: ${error?.message ?? "gagal dibuat"}`);
            break;
          }
        }
      }
    }
    if (!sama) {
      hasil.room_belum_dipetakan.push(r.roomName);
      continue;
    }
    const { error } = await db.from("cloudbeds_room_mapping").insert({ cloudbeds_room_id: r.roomID, cloudbeds_room_name: r.roomName, unit_id: sama.id });
    if (error) errors.push(`peta ${r.roomName}: ${error.message}`);
    else {
      hasil.dipetakan++;
      petaByCb.set(r.roomID, String(sama.id));
      sudahDipetakan.add(String(sama.id));
    }
  }

  // Blokir hari ini -> maintenance bertanda; dibuka -> available.
  for (const r of nyata) {
    const unit = petaByCb.get(r.roomID);
    const k = unit ? kamarById.get(unit) : undefined;
    if (!k) continue;
    const catatan = String(k.catatan ?? "");
    let isi: Record<string, unknown> | null = null;
    if (r.roomBlocked && k.status === "available") isi = { status: "maintenance", catatan: `${PENANDA_BLOK} ${catatan}`.trim() };
    else if (!r.roomBlocked && k.status === "maintenance" && catatan.includes(PENANDA_BLOK)) isi = { status: "available", catatan: catatan.replace(PENANDA_BLOK, "").trim() || null };
    if (!isi) continue;
    const { error } = await db.from("units").update(isi).eq("id", k.id);
    if (error) errors.push(`ubah kamar ${k.nomor}: ${error.message}`);
    else hasil.diubah++;
  }
  return hasil;
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

type BookingKirim = { id: string; guest_nama: string | null; guest_hp: string | null; tgl_checkin: string; tgl_checkout: string; adults: number | null; children: number | null };

async function kirimSatu(
  apiKey: string,
  propertyId: string,
  sourceId: string,
  b: BookingKirim,
  tipe: string,
  cbRoomId: string | undefined,
): Promise<{ reservationID: string; variant: string } | { error: string; attempts?: unknown[] }> {
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
    // Cloudbeds wajib email; alamat cadangan pola villa-api, tidak pernah dikirimi surat.
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
    ...(cbRoomId ? [{ nama: "with_roomID", form: () => { const f = dasar(); f.set("rooms[0][roomID]", cbRoomId); return f; } }] : []),
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
