import type { Booking } from "./types";

/**
 * Helper murni Kalender Booking (owner 2026-11-14: "desain lebih bagus dan
 * memudahkan"). Hanya posisi/pengelompokan tampilan dari baris GET /bookings;
 * tidak ada data atau rumus baru.
 */

const MS_HARI = 86400000;

export function selisihHari(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_HARI);
}

/**
 * Posisi batang ala kalender hotel: mulai di TENGAH hari check-in dan
 * berakhir di TENGAH hari check-out, sehingga hari pergantian tamu terlihat
 * sebagai dua setengah-batang yang berdampingan. Persen terhadap lebar
 * rentang `n` hari mulai `awal`. `potongKiri/Kanan` = batang terpotong
 * tepi rentang (ujungnya dibuat rata, bukan membulat).
 */
export function posisiBatang(
  b: Pick<Booking, "tgl_checkin" | "tgl_checkout">,
  awal: string,
  n: number,
): { kiri: number; lebar: number; potongKiri: boolean; potongKanan: boolean } | null {
  const mulai = selisihHari(awal, b.tgl_checkin) + 0.5;
  const selesai = b.tgl_checkout ? selisihHari(awal, b.tgl_checkout) + 0.5 : n;
  const kiri = Math.max(0, mulai);
  const kanan = Math.min(n, selesai);
  if (kanan <= kiri) return null;
  return { kiri: (kiri / n) * 100, lebar: ((kanan - kiri) / n) * 100, potongKiri: mulai < 0, potongKanan: selesai > n };
}

const MENGINAP = new Set(["terjadwal", "checkin", "checkout"]);

/** Tamu yang menempati unit pada MALAM tanggal `d` (masuk <= d < keluar). */
export function menginapMalam(b: Pick<Booking, "tgl_checkin" | "tgl_checkout" | "status">, d: string): boolean {
  if (!MENGINAP.has(b.status)) return false;
  return b.tgl_checkin <= d && (!b.tgl_checkout || d < b.tgl_checkout);
}

/** Jumlah unit terisi per malam (unit unik, bukan jumlah booking). */
export function terisiPerHari(bookings: Booking[], hari: string[]): number[] {
  return hari.map((d) => new Set(bookings.filter((b) => menginapMalam(b, d)).map((b) => b.unit_id)).size);
}

export type AgendaHari = { tanggal: string; datang: Booking[]; pulang: Booking[]; terisi: number };

/** Daftar per hari: siapa datang, siapa pulang, berapa unit terisi malam itu. */
export function agendaPerHari(bookings: Booking[], hari: string[]): AgendaHari[] {
  const terisi = terisiPerHari(bookings, hari);
  const urut = (a: Booking, b: Booking) => (a.unit_nomor ?? "").localeCompare(b.unit_nomor ?? "", "id", { numeric: true });
  return hari.map((d, i) => ({
    tanggal: d,
    datang: bookings.filter((b) => MENGINAP.has(b.status) && b.tgl_checkin === d).sort(urut),
    pulang: bookings.filter((b) => MENGINAP.has(b.status) && b.tgl_checkout === d).sort(urut),
    terisi: terisi[i],
  }));
}

/** Sabtu/Minggu (tanggal polos, dihitung di UTC agar tidak bergeser zona waktu). */
export function akhirPekan(d: string): boolean {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
}
