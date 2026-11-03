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
