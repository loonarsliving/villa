import { buildHandover } from "./handover";
import type { Booking } from "./types";

/**
 * Papan kerja resepsionis (owner 2026-11-14: "tampilan yang lebih
 * interaktif dan lebih mempermudah reception"). Murni pengelompokan baris
 * GET /bookings rentang kemarin..besok -- sama dengan Jadwal Tamu Hari Ini
 * (lib/handover.ts) -- menjadi daftar yang bisa langsung ditindaklanjuti.
 */

export type ItemDatang = { bk: Booking; selesai: boolean; terlambat: boolean };
export type ItemPulang = { bk: Booking; selesai: boolean };

export type Papan = {
  datang: ItemDatang[];
  pulang: ItemPulang[];
  /** Tamu yang sedang menginap (status checkin), per unit_id. */
  penghuni: Map<string, Booking>;
  /** Tamu yang dijadwalkan datang hari ini / terlambat dan belum check-in, per unit_id. */
  datangPerUnit: Map<string, Booking>;
  /** Tamu yang harus check-out hari ini dan belum check-out, per unit_id. */
  pulangPerUnit: Map<string, Booking>;
};

export function susunPapan(rows: Booking[], hariIni: string): Papan {
  const h = buildHandover(rows, hariIni);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ambil = (id: string) => byId.get(id)!;

  const datang: ItemDatang[] = [
    // Terlambat (dijadwalkan sebelum hari ini, belum datang) ditaruh paling atas.
    ...h.inHouse.filter((b) => b.status === "terjadwal").map((b) => ({ bk: ambil(b.id), selesai: false, terlambat: true })),
    ...h.checkin.map((b) => ({ bk: ambil(b.id), selesai: b.status !== "terjadwal", terlambat: false })),
  ];
  // Yang belum datang di atas, yang sudah check-in di bawah.
  datang.sort((a, b) => Number(a.selesai) - Number(b.selesai));

  const pulang: ItemPulang[] = h.checkout
    .filter((b) => b.status !== "terjadwal") // "tidak datang" bukan tugas check-out
    .map((b) => ({ bk: ambil(b.id), selesai: b.status === "checkout" }))
    .sort((a, b) => Number(a.selesai) - Number(b.selesai));

  const penghuni = new Map<string, Booking>();
  const datangPerUnit = new Map<string, Booking>();
  const pulangPerUnit = new Map<string, Booking>();
  for (const r of rows) {
    if (!r.unit_id) continue;
    if (r.status === "checkin") penghuni.set(r.unit_id, r);
  }
  for (const d of datang) if (!d.selesai && d.bk.unit_id) datangPerUnit.set(d.bk.unit_id, d.bk);
  for (const p of pulang) if (!p.selesai && p.bk.unit_id) pulangPerUnit.set(p.bk.unit_id, p.bk);

  return { datang, pulang, penghuni, datangPerUnit, pulangPerUnit };
}

/** Cocokkan pencarian resepsionis ke nama tamu, nomor unit, atau nomor HP. */
export function cocokCari(bk: Pick<Booking, "guest_nama" | "unit_nomor" | "guest_hp">, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const angka = s.replace(/[^\d]/g, "");
  return (
    bk.guest_nama.toLowerCase().includes(s) ||
    (bk.unit_nomor ?? "").toLowerCase() === s ||
    (bk.unit_nomor ?? "").toLowerCase().includes(s) ||
    (angka.length >= 4 && (bk.guest_hp ?? "").replace(/[^\d]/g, "").includes(angka))
  );
}

/** Nomor lokal "08..." -> tautan wa.me "628..." (pola sama dengan front-desk/bbq). */
export function tautanWa(hp: string | null | undefined): string | null {
  const d = (hp ?? "").replace(/[^\d]/g, "");
  if (d.length < 8) return null;
  return `https://wa.me/${d.startsWith("0") ? `62${d.slice(1)}` : d}`;
}

/** Jumlah malam menginap (null bila tanggal keluar belum ada). */
export function jumlahMalam(masuk: string, keluar: string | null): number | null {
  if (!keluar) return null;
  const n = Math.round((Date.parse(`${keluar}T00:00:00Z`) - Date.parse(`${masuk}T00:00:00Z`)) / 86400000);
  return n > 0 ? n : null;
}
