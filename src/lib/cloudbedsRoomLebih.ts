/**
 * Room "lebih" di Cloudbeds: room yang ada di Cloudbeds tetapi bukan kamar
 * fisik di sistem (owner 2026-11-09: Excellent Living hanya punya 2 kamar
 * Quadruple, tetapi Cloudbeds EL berisi QUA(1)-QUA(4)). API Cloudbeds tidak
 * bisa menghapus room, jadi room lebih DITUTUP (room block out_of_service)
 * selama JANGKA_HARI ke depan supaya OTA tidak pernah menjualnya. Sinkron
 * properti menjalankan ini tiap putaran, jadi blokirnya diperpanjang sendiri.
 *
 * Hanya room yang tipe Cloudbeds-nya SUDAH punya kamar berpeta di sistem:
 * itu berarti tipenya dikenal dan kamarnya sudah lengkap, jadi room sisanya
 * memang kelebihan. Room bertipe yang sama sekali belum dikenal (properti
 * baru, atau owner menambah tipe) tidak disentuh.
 *
 * Murni (tanpa I/O) supaya bisa dites; pemanggil ada di elCloudbedsSync.ts.
 */

export const JANGKA_HARI = 730;
/** Diperpanjang kalau tutupnya tinggal kurang dari ini. */
export const PERPANJANG_BILA_SISA_HARI = 365;
export const ALASAN_ROOM_LEBIH = "Kamar tidak ada di sistem Loonars (room lebih) - jangan dibuka";

export interface RoomCb {
  roomID: string;
  roomName: string;
  roomTypeID?: string;
  isVirtual?: boolean;
}

export interface BlokRoom {
  roomIds: string[];
  startDate: string;
  /** EKSKLUSIF (hari kamar terbuka lagi). null = tanpa akhir. */
  endDate: string | null;
}

export interface RencanaTutup {
  roomID: string;
  roomName: string;
  roomTypeID: string;
  startDate: string;
  endDate: string;
}

export function tambahHari(tgl: string, hari: number): string {
  return new Date(Date.parse(`${tgl}T00:00:00Z`) + hari * 86_400_000).toISOString().slice(0, 10);
}

/** Room Cloudbeds tanpa peta yang tipenya sudah punya kamar berpeta. */
export function roomLebih(rooms: RoomCb[], cbRoomBerpeta: Set<string>): RoomCb[] {
  const nyata = rooms.filter((r) => !r.isVirtual && r.roomTypeID);
  const tipeBerpeta = new Set(nyata.filter((r) => cbRoomBerpeta.has(r.roomID)).map((r) => String(r.roomTypeID)));
  return nyata.filter((r) => !cbRoomBerpeta.has(r.roomID) && tipeBerpeta.has(String(r.roomTypeID)));
}

/**
 * Hari pertama room terbuka mulai `dari` (melompati blokir yang menempel
 * berurutan). null = tertutup terus sampai `batas`.
 */
export function hariTerbuka(roomID: string, blok: BlokRoom[], dari: string, batas: string): string | null {
  let t = dari;
  for (let i = 0; i < 50 && t < batas; i++) {
    const kena = blok.find((b) => b.roomIds.includes(roomID) && b.startDate <= t && (b.endDate === null || b.endDate > t));
    if (!kena) return t;
    if (kena.endDate === null) return null;
    t = kena.endDate;
  }
  return t < batas ? t : null;
}

/**
 * Blokir baru yang perlu dibuat. Room yang sudah tertutup sampai minimal
 * hariIni + PERPANJANG_BILA_SISA_HARI dilewati. Blokir baru dimulai di hari
 * pertama room terbuka (tidak menumpuk blokir lama) dan berhenti sebelum
 * blokir berikutnya untuk room itu, kalau ada.
 */
export function rencanaTutupRoomLebih(lebih: RoomCb[], blok: BlokRoom[], hariIni: string): RencanaTutup[] {
  const sampai = tambahHari(hariIni, JANGKA_HARI);
  const cukup = tambahHari(hariIni, PERPANJANG_BILA_SISA_HARI);
  const hasil: RencanaTutup[] = [];
  for (const r of lebih) {
    const buka = hariTerbuka(r.roomID, blok, hariIni, cukup);
    if (buka === null) continue;
    const berikut = blok
      .filter((b) => b.roomIds.includes(r.roomID) && b.startDate > buka && b.startDate < sampai)
      .map((b) => b.startDate)
      .sort()[0];
    hasil.push({ roomID: r.roomID, roomName: r.roomName, roomTypeID: String(r.roomTypeID), startDate: buka, endDate: berikut ?? sampai });
  }
  return hasil;
}
