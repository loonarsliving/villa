import "server-only";
import { formSelarasKamar, rencanaSelarasKamar } from "@/lib/cloudbedsSelarasKamar";
import { judulGenting, kirimPeringatanKamarWa } from "@/lib/peringatanKamarWa";

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
import { bacaBlokirKamar, rencanaPindahKamar } from "@/lib/cloudbedsUnitSementara";
import { buatKodeTipe, jumlahMalam, kamarUntukNamaBerurut, normalNama, pecahNama, PENANDA_BLOK, pilihKamarEl, statusElDariCloudbeds, tarifDikunciLokal, type PemakaianKamar } from "@/lib/elCloudbedsLogic";
import { supabaseAdminProperti } from "@/lib/supabaseAdmin";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";
import { ALASAN_ROOM_LEBIH, hariTerbuka, PERPANJANG_BILA_SISA_HARI, rencanaTutupRoomLebih, roomLebih, tambahHari, type BlokRoom } from "@/lib/cloudbedsRoomLebih";

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

interface KamarResv { roomID?: string | null; roomTypeID?: string | null; subReservationID?: string | null; roomCheckIn?: string; roomCheckOut?: string; guestID?: string }
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
  /** Room Cloudbeds yang bukan kamar fisik di sistem dan ditutup otomatis (cloudbedsRoomLebih.ts). */
  room_lebih?: { room: string; ditutup: string | null; error?: string }[];
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

  // Room lebih di Cloudbeds (bukan kamar fisik) -> ditutup agar tidak dijual OTA.
  try {
    ringkasan.kamar.room_lebih = await tutupRoomLebih(apiKey, propertyId, roomsCb, new Set(kamarDariRoomCb.keys()), hariIni);
  } catch (e) {
    errors.push(`tutup room lebih: ${e instanceof Error ? e.message : String(e)}`);
  }
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

  // Peringatan genting: notifikasi aplikasi (sekali per judul) + WhatsApp
  // owner/manager/resepsionis -- owner 10 Nov 2026: "Jgan pernah biarkan ini
  // terulang lagi" (el nasution, PL: peringatan hanya di aplikasi, tak terbaca).
  const peringatkan = async (n: { unit_id: string | null; judul: string; pesan: string; ref_id: string | null }) => {
    const { data: sudah } = await db.from("notifications").select("id").eq("judul", n.judul).limit(1);
    if ((sudah ?? []).length > 0) return;
    const { error } = await db.from("notifications").insert({ ...n, target_role: "all", tipe: "booking" });
    if (error) errors.push(`notifikasi gagal (${n.judul}): ${error.message}`);
    if (judulGenting(n.judul)) {
      try {
        await kirimPeringatanKamarWa(db as unknown as SupabaseClient, n.judul, n.pesan);
      } catch (e) {
        errors.push(`WA peringatan gagal: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  const sejamLalu = new Date(Date.now() - 3600_000).toISOString();
  let percobaanSelaras = 0;

  for (const r of aktif) {
    const ada = lokal.get(r.reservationID);
    if (ada && bookingElMilikSendiri(ada.catatan)) {
      ringkasan.tarik.dilewati_milik_sendiri++;
      // Booking milik sistem: kamar Cloudbeds-nya disamakan dengan unitnya
      // (sama dengan PL, cloudbedsSelarasKamar.ts). Tanpa ini Cloudbeds bisa
      // menjual unit sistem itu ke OTA. adjustPrice tidak dikirim = harga tetap.
      const targetCb = ada.unit_id ? roomCbDariKamar.get(String(ada.unit_id)) : undefined;
      const rencana =
        STATUS_LOKAL_AKTIF.includes(ada.status) && targetCb
          ? rencanaSelarasKamar({ reservationID: r.reservationID, rooms: r.rooms, targetRoomID: targetCb, targetRoomTypeID: tipeDariRoomCb.get(targetCb) ?? null })
          : null;
      if (rencana && percobaanSelaras < 10) {
        const { data: baruGagal } = await db
          .from("cloudbeds_events_log")
          .select("id")
          .eq("event_type", "outbound.reservation.room_assigned")
          .eq("reservation_id", r.reservationID)
          .eq("matched", false)
          .gte("created_at", sejamLalu)
          .limit(1);
        const unitNo = nomorKamar.get(String(ada.unit_id)) ?? "?";
        // Kamar tujuan WAJIB kosong menurut Cloudbeds. Tanpa cek ini PL sempat
        // membuat A4 terisi ganda di Cloudbeds (10 Nov 2026).
        const masukEl = r.rooms?.[0]?.roomCheckIn ?? r.startDate;
        const keluarEl = r.rooms?.[0]?.roomCheckOut ?? r.endDate;
        const targetTerisi = aktif.some(
          (o) =>
            o.reservationID !== r.reservationID &&
            (o.rooms ?? []).some((x) => String(x.roomID ?? "") === rencana.newRoomID && (x.roomCheckIn ?? o.startDate) < keluarEl && masukEl < (x.roomCheckOut ?? o.endDate)),
        );
        if (targetTerisi) {
          await peringatkan({
            unit_id: String(ada.unit_id),
            judul: `Kamar Cloudbeds belum sama (${kode} ${r.reservationID}) — harus Kamar ${unitNo}`,
            pesan: `Booking ${kode} ini (${masukEl} s/d ${keluarEl}) dibuat di sistem untuk Kamar ${unitNo}, tapi di Cloudbeds kamar itu sudah dipakai reservasi lain. Atur kamarnya di Cloudbeds supaya sama dengan sistem.`,
            ref_id: ada.id,
          });
        } else if ((baruGagal ?? []).length > 0) {
          // Sudah dikirim < 1 jam lalu dan Cloudbeds MASIH beda: baru sekarang
          // dianggap gagal sungguhan. Jawaban postRoomAssign sendiri tidak
          // dipercaya -- di PL, "Room could not be assigned" terbukti tetap
          // diterapkan (10 Nov 2026).
          await peringatkan({
            unit_id: String(ada.unit_id),
            judul: `Kamar Cloudbeds belum sama (${kode} ${r.reservationID}) — harus Kamar ${unitNo}`,
            pesan: `Booking ${kode} ini dibuat di sistem untuk Kamar ${unitNo}, tapi di Cloudbeds kamarnya ${rencana.oldRoomID ? "lain" : "belum di-assign"} dan sistem gagal memindahkannya otomatis. Selama belum sama, Cloudbeds bisa menjual Kamar ${unitNo} ke OTA. Assign Kamar ${unitNo} di Cloudbeds.`,
            ref_id: ada.id,
          });
        } else {
          percobaanSelaras++;
          let ok = false;
          let jawaban: unknown = null;
          try {
            const res = await fetch(`${CLOUDBEDS_API_BASE}/postRoomAssign`, {
              method: "POST",
              headers: { "x-api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
              body: formSelarasKamar(rencana, propertyId).toString(),
              cache: "no-store",
              signal: AbortSignal.timeout(20_000),
            });
            jawaban = await res.json().catch(() => null);
            const b = jawaban as { success?: unknown } | null;
            ok = res.ok && b?.success !== false && b?.success !== "false";
          } catch (e) {
            jawaban = { error: e instanceof Error ? e.message : String(e) };
          }
          await catat(db, {
            reservation_id: r.reservationID,
            event_type: "outbound.reservation.room_assigned",
            payload: { properti: kode, sumber_proses: "sync", unit_nomor: unitNo, rencana, jawaban },
            matched: ok,
            error: ok ? null : String((jawaban as { message?: unknown } | null)?.message ?? "gagal"),
          });
        }
      }
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
      // Dulu hanya dicatat di log -- staf tidak pernah tahu. Kini notifikasi
      // + WA, dan dibedakan: kamar cukup tiap malam (perlu pindah kamar)
      // atau benar-benar penuh (overbooking).
      const rencanaPindah = tipe
        ? rencanaPindahKamar({
            roomTypeId: tipe,
            checkIn,
            checkOut,
            // Semua kamar fisik setipe (kandidatPerTipe), dengan ID buatan
            // "<tipe>-<urut>" supaya dikenali sebagai satu tipe; blokir
            // Cloudbeds sudah masuk `terpakai` per kamar.
            kandidat: (kandidatPerTipe.get(tipe) ?? []).map((unitId, i) => ({ cloudbedsRoomId: `${tipe}-${i}`, unitId, unitNomor: nomorKamar.get(unitId) ?? null })),
            terpakai: terpakai.filter((p) => p.reservationId !== r.reservationID).map((p) => ({ unitId: p.roomId, checkIn: p.checkIn, checkOut: p.checkOut })),
            blokir: [],
          })
        : null;
      const namaTamu = (() => {
        const t0 = kamarCb?.guestID ? r.guestList?.[kamarCb.guestID] : undefined;
        return t0?.guestFirstName || t0?.guestLastName ? `${t0?.guestFirstName ?? ""} ${t0?.guestLastName ?? ""}`.trim() : (r.guestName ?? "Tamu Cloudbeds");
      })();
      if (rencanaPindah?.bisa) {
        await peringatkan({
          unit_id: null,
          judul: `PERLU PINDAH KAMAR — reservasi Cloudbeds ${kode} ${r.reservationID} belum masuk sistem`,
          pesan: `${namaTamu} (${checkIn} s/d ${checkOut}) BUKAN overbooking: tiap malam masih ada kamar kosong, tapi tidak ada satu kamar yang kosong untuk seluruh menginap. Saran: ${rencanaPindah.segmen.map((g) => `Kamar ${g.unit.unitNomor ?? "?"} ${g.dari} s/d ${g.sampai}`).join(", lalu ")}. Atur kamarnya di Cloudbeds.`,
          ref_id: null,
        });
      } else {
        const malam = rencanaPindah && !rencanaPindah.bisa && rencanaPindah.malamPenuh.length ? ` Malam penuh: ${rencanaPindah.malamPenuh.join(", ")}.` : "";
        await peringatkan({
          unit_id: null,
          judul: `TIDAK MASUK SISTEM — reservasi Cloudbeds ${kode} ${r.reservationID}`,
          pesan: `${namaTamu} (${checkIn} s/d ${checkOut}) ada di Cloudbeds ${kode} tapi semua kamar tipe ini terisi di sistem.${malam} Kemungkinan overbooking -- atur kamarnya sekarang.`,
          ref_id: null,
        });
      }
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
          : await kirimSatu(apiKey, propertyId, sourceId, { ...b, tgl_checkout: String(b.tgl_checkout), guest_hp: hp }, tipeCb, roomCbDariKamar.get(String(b.unit_id)), (() => {
              // Kunci kamar hanya bila kamar itu kosong di Cloudbeds (daftar reservasi aktif di atas).
              const cb = roomCbDariKamar.get(String(b.unit_id));
              if (!cb) return false;
              return !aktif.some((o) => (o.rooms ?? []).some((x) => String(x.roomID ?? "") === cb && (x.roomCheckIn ?? o.startDate) < String(b.tgl_checkout) && b.tgl_checkin < (x.roomCheckOut ?? o.endDate)));
            })());
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

const CB_API = "https://api.cloudbeds.com/api/v1.2";

async function bacaBlokRoom(apiKey: string, propertyId: string, dari: string, sampai: string): Promise<{ id: string; blok: BlokRoom }[]> {
  const q = new URLSearchParams({ propertyID: propertyId, startDate: dari, endDate: sampai, pageSize: "100" });
  const res = await fetch(`${CB_API}/getRoomBlocks?${q}`, { headers: { "x-api-key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string; data?: unknown } | null;
  if (!res.ok || body?.success === false) throw new Error(`getRoomBlocks: ${body?.message ?? `HTTP ${res.status}`}`);
  const wadah = Array.isArray(body?.data) ? body.data : [body?.data];
  const hasil: { id: string; blok: BlokRoom }[] = [];
  for (const w of wadah) {
    for (const k of ((w as { roomBlocks?: unknown[] } | null)?.roomBlocks ?? []) as { roomBlockID?: unknown; startDate?: unknown; endDate?: unknown; rooms?: { roomID?: unknown }[] }[]) {
      if (typeof k.startDate !== "string") continue;
      hasil.push({
        id: String(k.roomBlockID ?? ""),
        blok: { roomIds: (k.rooms ?? []).map((r) => String(r.roomID ?? "")).filter(Boolean), startDate: k.startDate, endDate: typeof k.endDate === "string" ? k.endDate : null },
      });
    }
  }
  return hasil;
}

/**
 * Tutup room Cloudbeds yang bukan kamar fisik di sistem (owner 2026-11-09:
 * EL hanya 2 Quadruple, Cloudbeds berisi QUA(1)-(4)). Hanya menulis room
 * block out_of_service untuk room tanpa peta; kamar berpeta tidak disentuh.
 * Blokir dianggap berhasil hanya kalau terbaca balik di Cloudbeds.
 */
async function tutupRoomLebih(apiKey: string, propertyId: string, roomsCb: CloudbedsRoom[], berpeta: Set<string>, hariIni: string) {
  const lebih = roomLebih(roomsCb, berpeta);
  if (!lebih.length) return [];
  // getRoomBlocks Cloudbeds menolak rentang > 35 hari: baca per jendela 35 hari,
  // mulai hari ini, lalu melompat ke hari pertama room lebih terbuka sampai
  // semuanya tertutup cukup lama atau hari terbukanya terbaca (maks 25 jendela).
  const cukup = tambahHari(hariIni, PERPANJANG_BILA_SISA_HARI);
  const semua = new Map<string, BlokRoom>();
  const baca = async (dari: string) => {
    const ke = tambahHari(dari, 34);
    for (const b of await bacaBlokRoom(apiKey, propertyId, dari, ke)) semua.set(b.id || JSON.stringify(b.blok), b.blok);
    return ke;
  };
  let horizon = await baca(hariIni);
  for (let i = 0; i < 25; i++) {
    const daftar = [...semua.values()];
    const belum = lebih.map((r) => hariTerbuka(r.roomID, daftar, hariIni, cukup)).filter((t): t is string => t !== null && t > horizon).sort();
    if (!belum.length) break;
    horizon = await baca(belum[0]);
  }
  const rencana = rencanaTutupRoomLebih(lebih, [...semua.values()], hariIni);
  const hasil: { room: string; ditutup: string | null; error?: string }[] = lebih
    .filter((r) => !rencana.some((x) => x.roomID === r.roomID))
    .map((r) => ({ room: r.roomName, ditutup: "sudah tertutup" }));
  for (const r of rencana) {
    const form = new URLSearchParams({ propertyID: propertyId, roomBlockType: "out_of_service", roomBlockReason: ALASAN_ROOM_LEBIH, startDate: r.startDate, endDate: r.endDate });
    form.set("rooms[0][roomID]", r.roomID);
    form.set("rooms[0][roomTypeID]", r.roomTypeID);
    const res = await fetch(`${CB_API}/postRoomBlock`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string; roomBlockID?: unknown } | null;
    const id = body?.roomBlockID ? String(body.roomBlockID) : null;
    const terbaca = id ? (await bacaBlokRoom(apiKey, propertyId, r.startDate, r.startDate)).some((b) => b.id === id && b.blok.roomIds.includes(r.roomID)) : false;
    hasil.push(
      terbaca
        ? { room: r.roomName, ditutup: `${r.startDate} s/d ${r.endDate}` }
        : { room: r.roomName, ditutup: null, error: body?.message ?? `postRoomBlock HTTP ${res.status}${id ? " (tidak terbaca balik)" : ""}` },
    );
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
  /** Kamar cbRoomId kosong di Cloudbeds untuk tanggal ini -- hanya lalu kamarnya dikunci. */
  kamarKosongDiCb = false,
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
    if (res.ok && body?.success !== false && body?.reservationID) {
      // Kamar langsung dikunci ke unit sistem, sama dengan villa-api (PL):
      // reservasi tipe-kamar-saja dibiarkan "unassigned" oleh Cloudbeds,
      // lalu Cloudbeds bebas menjual unit sistem itu ke OTA (el nasution,
      // PL, 10 Nov 2026). postRoomAssign pms-v1.2; adjustPrice tidak dikirim
      // = harga tetap. Best-effort: gagal tidak membatalkan push.
      const sub = Array.isArray(body?.unassigned) ? body.unassigned[0]?.subReservationID : null;
      if (cbRoomId && sub && kamarKosongDiCb) {
        try {
          const f = formSelarasKamar(
            { reservationID: String(body.reservationID), subReservationID: String(sub), newRoomID: cbRoomId, roomTypeID: tipe, oldRoomID: null },
            propertyId,
          );
          const ra = await fetch(`${CLOUDBEDS_API_BASE}/postRoomAssign`, {
            method: "POST",
            headers: { "x-api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
            body: f.toString(),
          });
          const raBody = await ra.json().catch(() => null);
          attempts.push({ variant: "postRoomAssign", http: ra.status, success: raBody?.success ?? null, message: raBody?.message ?? null });
        } catch (e) {
          attempts.push({ variant: "postRoomAssign", error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { reservationID: String(body.reservationID), variant: v.nama };
    }
  }
  return { error: "postReservation_failed_all_variants", attempts };
}
