import { cloudbedsRoomTypeIdOf } from "./cloudbedsRoomTypeMapping";

/**
 * Unit sementara untuk reservasi Cloudbeds yang belum diberi nomor kamar.
 *
 * OTA (Booking.com, Agoda, ...) memesan TIPE kamar, bukan kamar tertentu.
 * Selama resepsionis belum meng-assign kamarnya di Cloudbeds, reservasi itu
 * datang tanpa roomID -- dan sync dulu melewatinya begitu saja, karena
 * bookings.unit_id wajib diisi. Akibatnya tamunya tidak ada di sistem sama
 * sekali, dan website tetap menjual kamar untuk malam yang sama.
 *
 * Kejadian nyata 29 Okt 2026: Albi Arjani (Booking.com 68CNS8H63H, Regular
 * Room with pool, 29-31 Okt) ada di Cloudbeds tapi tidak di sistem; enam jam
 * kemudian website menjual B1 untuk malam yang sama ke tamu lain.
 *
 * Fungsi ini memilih unit dari tipe kamar yang sama yang kosong di seluruh
 * rentang menginap -- tidak bertabrakan dengan booking aktif mana pun dan
 * tidak sedang diblokir di Cloudbeds. Begitu Cloudbeds meng-assign kamar,
 * sync berikutnya memakai kamar dari Cloudbeds seperti biasa.
 */

export interface KandidatUnit {
  cloudbedsRoomId: string;
  unitId: string;
  unitNomor: string | null;
}

export interface Pemakaian {
  unitId: string;
  checkIn: string;
  /** null = belum ditentukan, dianggap terpakai seterusnya (sama dengan constraint bookings_no_overlap_active). */
  checkOut: string | null;
}

export interface BlokirKamar {
  roomIds: string[];
  startDate: string;
  /** EKSKLUSIF -- hari kamar dibuka lagi (lihat normalBlok di villa-api). */
  endDate: string | null;
}

function bertabrakan(aMulai: string, aSelesai: string | null, bMulai: string, bSelesai: string | null): boolean {
  // Rentang setengah terbuka [mulai, selesai), sama dengan daterange '[)'.
  const aAkhir = aSelesai ?? "9999-12-31";
  const bAkhir = bSelesai ?? "9999-12-31";
  return aMulai < bAkhir && bMulai < aAkhir;
}

function urutanKamar(roomId: string): number {
  const m = /-(\d+)$/.exec(roomId);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export function pilihUnitSementara(params: {
  roomTypeId: string;
  checkIn: string;
  checkOut: string | null;
  kandidat: KandidatUnit[];
  terpakai: Pemakaian[];
  blokir: BlokirKamar[];
  /** Unit yang sudah dipakai booking ini di sync sebelumnya -- dipertahankan kalau masih kosong, supaya tamu tidak berpindah kamar tiap sync. */
  unitSebelumnya?: string | null;
}): KandidatUnit | null {
  const { roomTypeId, checkIn, checkOut, terpakai, blokir, unitSebelumnya } = params;
  const kosong = (k: KandidatUnit) =>
    !terpakai.some((p) => p.unitId === k.unitId && bertabrakan(checkIn, checkOut, p.checkIn, p.checkOut)) &&
    !blokir.some((b) => b.roomIds.includes(k.cloudbedsRoomId) && bertabrakan(checkIn, checkOut, b.startDate, b.endDate));

  const sesuaiTipe = params.kandidat
    .filter((k) => cloudbedsRoomTypeIdOf(k.cloudbedsRoomId) === roomTypeId)
    .sort((a, b) => urutanKamar(a.cloudbedsRoomId) - urutanKamar(b.cloudbedsRoomId));

  const lama = unitSebelumnya ? sesuaiTipe.find((k) => k.unitId === unitSebelumnya) : undefined;
  if (lama && kosong(lama)) return lama;
  return sesuaiTipe.find(kosong) ?? null;
}

/** Membaca jawaban getRoomBlocks Cloudbeds menjadi BlokirKamar[]; bentuk yang tidak dikenal diabaikan. */
export function bacaBlokirKamar(data: unknown[]): BlokirKamar[] {
  const hasil: BlokirKamar[] = [];
  for (const wadah of data) {
    const blocks = (wadah as { roomBlocks?: unknown } | null)?.roomBlocks;
    for (const raw of Array.isArray(blocks) ? blocks : []) {
      const blk = raw as { startDate?: unknown; endDate?: unknown; rooms?: unknown };
      if (typeof blk.startDate !== "string") continue;
      const rooms = Array.isArray(blk.rooms) ? blk.rooms : [];
      hasil.push({
        roomIds: rooms.map((r) => String((r as { roomID?: unknown })?.roomID ?? "")).filter(Boolean),
        startDate: blk.startDate,
        endDate: typeof blk.endDate === "string" ? blk.endDate : null,
      });
    }
  }
  return hasil;
}
