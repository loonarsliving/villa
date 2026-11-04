/**
 * Logika murni sinkron Cloudbeds <-> Loonars Excellent Living (tanpa I/O),
 * supaya bisa dites. Pola sama dengan Private Living
 * (cloudbedsReservationSync.ts + cloudbedsUnitSementara.ts), disederhanakan
 * untuk tabel el_* yang tidak punya constraint anti-bentrok di database:
 * bentrok kamar dicek di sini.
 */

export interface PemakaianKamar {
  roomId: string;
  checkIn: string;
  checkOut: string;
  /** ID reservasi Cloudbeds pemilik pemakaian ini (null = booking lokal). */
  reservationId: string | null;
}

/** Dua rentang menginap [in, out) bertumpuk. */
export function bertumpuk(aIn: string, aOut: string, bIn: string, bOut: string): boolean {
  return aIn < bOut && bIn < aOut;
}

/** Kamar ini kosong untuk rentang tsb (pemakaian milik reservasi sendiri diabaikan). */
export function kamarKosong(roomId: string, checkIn: string, checkOut: string, terpakai: PemakaianKamar[], reservationId: string | null): boolean {
  return !terpakai.some(
    (p) => p.roomId === roomId && (reservationId === null || p.reservationId !== reservationId) && bertumpuk(checkIn, checkOut, p.checkIn, p.checkOut),
  );
}

/**
 * Pilih kamar EL untuk reservasi Cloudbeds.
 *  1. Kamar yang Cloudbeds tetapkan (sudah dipetakan) kalau kosong.
 *  2. Kalau tidak ada / bentrok: kamar lain setipe Cloudbeds yang kosong,
 *     kamar sebelumnya didahulukan (supaya tidak berpindah tiap sync).
 *  3. null = tidak ada kamar kosong (overbooking -- staf harus mengatur).
 */
export function pilihKamarEl(opts: {
  kamarCloudbeds: string | null;
  kandidatSetipe: string[];
  kamarSebelumnya: string | null;
  checkIn: string;
  checkOut: string;
  terpakai: PemakaianKamar[];
  reservationId: string;
}): { roomId: string; pindah: boolean } | null {
  const { kamarCloudbeds, kandidatSetipe, kamarSebelumnya, checkIn, checkOut, terpakai, reservationId } = opts;
  const kosong = (id: string) => kamarKosong(id, checkIn, checkOut, terpakai, reservationId);
  if (kamarCloudbeds && kosong(kamarCloudbeds)) return { roomId: kamarCloudbeds, pindah: false };
  const urutan = [...(kamarSebelumnya ? [kamarSebelumnya] : []), ...kandidatSetipe.filter((k) => k !== kamarSebelumnya)];
  for (const id of urutan) {
    if (id === kamarCloudbeds) continue;
    if (kandidatSetipe.includes(id) && kosong(id)) return { roomId: id, pindah: kamarCloudbeds !== null };
  }
  return null;
}

/** Status Cloudbeds -> status el_bookings (sebelum aturan meja depan). */
export function statusElDariCloudbeds(status: string): "terjadwal" | "checkin" {
  return status === "checked_in" ? "checkin" : "terjadwal";
}

const SUMBER_EL = ["walk-in", "whatsapp", "website", "cloudbeds", "airbnb", "agoda", "booking.com", "tiket", "traveloka", "google", "other"];

/** Nilai sumber yang lolos CHECK el_bookings_sumber_check. */
export function sumberEl(s: string): string {
  return SUMBER_EL.includes(s) ? s : "cloudbeds";
}

/** Booking EL yang lahir di sistem kita (front desk/website), bukan salinan Cloudbeds. */
export function elDibuatDiSini(dibuatOleh: string | null | undefined): boolean {
  return (dibuatOleh ?? "") !== "cloudbeds";
}

/** Nama tamu dipecah untuk postReservation (Cloudbeds wajib first + last). */
export function pecahNama(nama: string | null | undefined): { first: string; last: string } {
  const n = (nama ?? "").trim() || "Tamu Excellent Living";
  const i = n.indexOf(" ");
  return i === -1 ? { first: n, last: n } : { first: n.slice(0, i), last: n.slice(i + 1).trim() || n.slice(0, i) };
}

/** Jumlah malam antara dua tanggal YYYY-MM-DD. */
export function jumlahMalam(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
}

// ── Kamar dari Cloudbeds ───────────────────────────────────────────────
// Owner 2026-11-03: "tolong buat dia ambil data dari cloudbeds sj, jdi kt
// bisa buka tutup kamar dgan mudah". Cloudbeds = sumber daftar kamar EL:
// kamar & tipe dibuat/dipetakan otomatis, kamar berpeta yang hilang dari
// Cloudbeds dinonaktifkan, kamar yang diblokir hari ini jadi 'maintenance'.
// Revisi owner 2026-11-04 ("kt atur dari sini saja"): nama kamar tidak
// ditimpa, dan kamar tambahan yang dibuat di sistem tidak dinonaktifkan.

export interface RoomCb { roomID: string; roomName: string; roomTypeID?: string; roomTypeName?: string; roomTypeNameShort?: string; roomBlocked?: boolean; isVirtual?: boolean }
export interface TipeLokal { id: string; kode: string; nama: string; active: boolean }
export interface KamarLokal { id: string; nomor: string; room_type_id: string; status: string; active: boolean; catatan: string | null }
export interface PetaLokal { cloudbeds_room_id: string; room_id: string }

/** Penanda di catatan kamar bahwa status 'maintenance' berasal dari blokir Cloudbeds. */
export const PENANDA_BLOK = "[Blok Cloudbeds]";

export function normalNama(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Room Cloudbeds bernama berurut "KODE(n)" (nama bawaan Cloudbeds, mis.
 * "DOU(2)") dipetakan ke kamar ke-n tipe KODE, diurut menurut nomor kamar
 * (owner 2026-11-04: kamar diatur di sistem, Cloudbeds mengikut jumlah kamar
 * per tipe). DOU(2) -> ST-02, QUA(2) -> ST-14. Nomor di luar jumlah kamar
 * tipe itu (mis. QUA(3) padahal kamar quad hanya 2) tidak dipetakan.
 */
export function kamarUntukNamaBerurut<K extends { id: string | number; nomor: string; room_type_id: string | number | null }>(
  roomName: string | null | undefined,
  roomTypeNameShort: string | null | undefined,
  tipe: { id: string | number; code: string }[],
  kamar: K[],
): K | null {
  const m = /^\s*([A-Za-z0-9]+)\s*\(\s*(\d+)\s*\)\s*$/.exec(roomName ?? "");
  if (!m) return null;
  const kode = m[1].toUpperCase();
  if (roomTypeNameShort && roomTypeNameShort.trim().toUpperCase() !== kode) return null;
  const t = tipe.find((x) => String(x.code).toUpperCase() === kode);
  if (!t) return null;
  const setipe = kamar.filter((k) => String(k.room_type_id) === String(t.id)).sort((a, b) => a.nomor.localeCompare(b.nomor, "en", { numeric: true }));
  const n = Number(m[2]);
  return n >= 1 && n <= setipe.length ? setipe[n - 1] : null;
}

/** Kode tipe kamar unik: singkatan Cloudbeds, atau huruf depan nama. */
export function buatKodeTipe(nama: string, singkat: string | undefined, dipakai: Set<string>): string {
  const dasar =
    (singkat ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) ||
    nama.trim().split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) ||
    "TIPE";
  let kode = dasar;
  for (let i = 2; dipakai.has(kode); i++) kode = `${dasar}${i}`;
  dipakai.add(kode);
  return kode;
}

export interface RencanaKamar {
  /** Tipe Cloudbeds yang belum ada padanannya -> dibuat. kunci = roomTypeID Cloudbeds. */
  tipeBaru: { kunci: string; kode: string; nama: string; sort_order: number }[];
  /** roomTypeID Cloudbeds -> id tipe lokal yang sudah ada. */
  tipeCocok: Map<string, string>;
  /** Kamar lokal yang dipakai untuk room Cloudbeds (dipetakan otomatis bila belum). */
  petaBaru: { cloudbeds_room_id: string; cloudbeds_room_name: string; room_id: string }[];
  /** Room Cloudbeds tanpa kamar lokal -> dibuat (tipe dari kunci). */
  kamarBaru: { cloudbeds_room_id: string; nomor: string; kunciTipe: string; sort_order: number }[];
  /** Kamar lokal yang sudah dipetakan: field yang perlu diubah. */
  ubahKamar: { id: string; isi: Partial<{ nomor: string; active: boolean; status: string; catatan: string | null; sort_order: number }>; kunciTipe?: string }[];
  /** Kamar lokal aktif yang tidak ada di Cloudbeds -> dinonaktifkan. */
  nonaktifkan: string[];
}

export function rencanakanKamarEl(roomsCb: RoomCb[], tipe: TipeLokal[], kamar: KamarLokal[], peta: PetaLokal[]): RencanaKamar {
  const nyata = roomsCb.filter((r) => !r.isVirtual && r.roomTypeID);
  const kodeDipakai = new Set(tipe.map((t) => t.kode.toUpperCase()));
  const tipeCocok = new Map<string, string>();
  const tipeBaru: RencanaKamar["tipeBaru"] = [];
  const tipeCb = new Map<string, RoomCb>();
  for (const r of nyata) if (!tipeCb.has(r.roomTypeID!)) tipeCb.set(r.roomTypeID!, r);

  // Tipe: dari kamar yang sudah dipetakan dulu, lalu nama/singkatan yang sama.
  const kamarById = new Map(kamar.map((k) => [k.id, k]));
  const petaByCb = new Map(peta.map((p) => [p.cloudbeds_room_id, p.room_id]));
  for (const r of nyata) {
    const lokal = petaByCb.get(r.roomID);
    const k = lokal ? kamarById.get(lokal) : undefined;
    if (k && !tipeCocok.has(r.roomTypeID!)) tipeCocok.set(r.roomTypeID!, k.room_type_id);
  }
  let urut = tipe.length;
  for (const [kunci, r] of tipeCb) {
    if (tipeCocok.has(kunci)) continue;
    const t =
      tipe.find((x) => normalNama(x.nama) === normalNama(r.roomTypeName)) ??
      tipe.find((x) => r.roomTypeNameShort && x.kode.toUpperCase() === r.roomTypeNameShort.trim().toUpperCase());
    if (t) tipeCocok.set(kunci, t.id);
    else tipeBaru.push({ kunci, kode: buatKodeTipe(r.roomTypeName ?? "Kamar", r.roomTypeNameShort, kodeDipakai), nama: (r.roomTypeName ?? "Kamar").trim(), sort_order: ++urut });
  }

  // Kamar.
  const terpakai = new Set<string>();
  const petaBaru: RencanaKamar["petaBaru"] = [];
  const kamarBaru: RencanaKamar["kamarBaru"] = [];
  const ubahKamar: RencanaKamar["ubahKamar"] = [];
  const nomorDipakai = new Set(kamar.map((k) => normalNama(k.nomor)));
  nyata.forEach((r, i) => {
    let lokal = petaByCb.get(r.roomID);
    if (lokal && !kamarById.has(lokal)) lokal = undefined;
    if (!lokal) {
      const sama = kamar.find((k) => normalNama(k.nomor) === normalNama(r.roomName) && !terpakai.has(k.id) && ![...petaByCb.values()].includes(k.id));
      if (sama) {
        lokal = sama.id;
        petaBaru.push({ cloudbeds_room_id: r.roomID, cloudbeds_room_name: r.roomName, room_id: sama.id });
      }
    }
    if (!lokal) {
      let nomor = r.roomName.trim() || r.roomID;
      for (let n = 2; nomorDipakai.has(normalNama(nomor)); n++) nomor = `${r.roomName.trim() || r.roomID} (${n})`;
      nomorDipakai.add(normalNama(nomor));
      kamarBaru.push({ cloudbeds_room_id: r.roomID, nomor, kunciTipe: r.roomTypeID!, sort_order: i + 1 });
      return;
    }
    terpakai.add(lokal);
    const k = kamarById.get(lokal)!;
    const isi: RencanaKamar["ubahKamar"][number]["isi"] = {};
    if (!k.active) isi.active = true;
    // Nama kamar diatur di sistem ini (owner 2026-11-04: "kt atur dari sini
    // saja"), tidak ditimpa nama room Cloudbeds.
    const catatan = k.catatan ?? "";
    const dariBlok = catatan.includes(PENANDA_BLOK);
    if (r.roomBlocked && k.status === "available") {
      isi.status = "maintenance";
      isi.catatan = `${PENANDA_BLOK} ${catatan}`.trim();
    } else if (!r.roomBlocked && k.status === "maintenance" && dariBlok) {
      isi.status = "available";
      isi.catatan = catatan.replace(PENANDA_BLOK, "").trim() || null;
    }
    const ubahTipe = tipeCocok.get(r.roomTypeID!) !== k.room_type_id;
    if (Object.keys(isi).length || ubahTipe) ubahKamar.push({ id: k.id, isi, ...(ubahTipe ? { kunciTipe: r.roomTypeID! } : {}) });
  });

  // Hanya kamar yang DIPETAKAN ke room Cloudbeds yang sudah tidak ada lagi
  // yang dinonaktifkan. Kamar yang dibuat admin di sistem ini (tanpa room
  // Cloudbeds sendiri) dibiarkan.
  const kamarBerpeta = new Set(peta.filter((p) => kamarById.has(p.room_id)).map((p) => p.room_id));
  const nonaktifkan = kamar.filter((k) => k.active && kamarBerpeta.has(k.id) && !terpakai.has(k.id)).map((k) => k.id);
  return { tipeBaru, tipeCocok, petaBaru, kamarBaru, ubahKamar, nonaktifkan };
}
