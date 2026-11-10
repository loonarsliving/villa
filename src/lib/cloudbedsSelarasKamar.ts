/**
 * Menyamakan KAMAR reservasi Cloudbeds dengan unit booking buatan sistem
 * (website / investor / KOL / front desk) yang sudah didorong ke Cloudbeds.
 *
 * Masalah yang ditutup (10 Nov 2026, "el nasution" tidak masuk sistem):
 * villa-api mendorong booking website ke Cloudbeds hanya dengan TIPE kamar
 * -- postReservation menolak roomID ("Invalid Parameters"), lihat
 * pushBookingToCloudbeds -- jadi di Cloudbeds reservasinya tanpa kamar atau
 * di kamar pilihan Cloudbeds, sedangkan di sistem tamunya di unit tertentu.
 * Cloudbeds lalu menganggap unit sistem itu kosong dan menaruh tamu OTA di
 * sana; sync menolak tamu OTA itu karena unitnya sudah terisi (bentrok /
 * "TIDAK MASUK SISTEM"). Sejak akhir Oktober pola ini berulang di A4.
 *
 * Kamar ditetapkan lewat postRoomAssign (pms-v1.2, scope write:room;
 * cloudbeds/openapi-specs PostRoomAssignRequest): reservationID,
 * subReservationID, newRoomID, roomTypeID, oldRoomID (wajib kalau
 * reassign). adjustPrice tidak dikirim -- default false, "the rate will
 * retain its original value" -- jadi harga reservasi TIDAK berubah.
 */

export interface KamarReservasi {
  roomID?: string | null;
  roomTypeID?: string | null;
  subReservationID?: string | null;
}

export interface RencanaSelaras {
  reservationID: string;
  subReservationID: string;
  newRoomID: string;
  roomTypeID: string;
  oldRoomID: string | null;
}

/**
 * Menentukan apakah reservasi milik sistem perlu dipindah kamar di Cloudbeds.
 * null = sudah sama, atau datanya tidak cukup untuk menetapkan dengan aman
 * (beberapa kamar dalam satu reservasi, tipe kamar target tidak diketahui,
 * subReservationID tidak ada).
 */
export function rencanaSelarasKamar(input: {
  reservationID: string;
  rooms: KamarReservasi[] | null | undefined;
  targetRoomID: string | null | undefined;
  targetRoomTypeID: string | null | undefined;
}): RencanaSelaras | null {
  const rooms = input.rooms ?? [];
  const target = String(input.targetRoomID ?? "").trim();
  const tipe = String(input.targetRoomTypeID ?? "").trim();
  // Sistem ini satu kamar per booking. Reservasi multi-kamar tidak disentuh:
  // tidak ada cara aman menebak kamar mana yang dimaksud.
  if (!target || !tipe || rooms.length !== 1) return null;
  const kamar = rooms[0];
  const sekarang = String(kamar.roomID ?? "").trim();
  if (sekarang === target) return null;
  const sub = String(kamar.subReservationID ?? "").trim();
  if (!sub) return null;
  return {
    reservationID: input.reservationID,
    subReservationID: sub,
    newRoomID: target,
    roomTypeID: tipe,
    oldRoomID: sekarang || null,
  };
}

/** Badan form postRoomAssign. adjustPrice sengaja tidak dikirim (default false = harga tetap). */
export function formSelarasKamar(r: RencanaSelaras, propertyId?: string | null): URLSearchParams {
  const f = new URLSearchParams();
  if (propertyId) f.set("propertyID", propertyId);
  f.set("reservationID", r.reservationID);
  f.set("subReservationID", r.subReservationID);
  f.set("newRoomID", r.newRoomID);
  f.set("roomTypeID", r.roomTypeID);
  if (r.oldRoomID) f.set("oldRoomID", r.oldRoomID);
  return f;
}
