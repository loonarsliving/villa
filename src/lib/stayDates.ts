/**
 * Tanggal menginap (check-in/check-out) untuk alur walk-in Front Desk.
 *
 * Kenapa ini dipisah jadi modul sendiri: rentang tanggal booking adalah
 * satu-satunya hal yang melindungi unit dari double-booking. Di database,
 * proteksinya berupa exclusion constraint `bookings_no_overlap_active`
 * atas `daterange(tgl_checkin, coalesce(tgl_checkout,'infinity'), '[)')`,
 * dan villa-api memakai `datesOverlap()` yang bentuknya sama.
 *
 * Keduanya punya lubang yang sama: kalau tgl_checkout == tgl_checkin,
 * rentangnya KOSONG, dan rentang kosong tidak pernah bertabrakan dengan
 * apa pun. Jadi booking 0 malam lolos dari exclusion constraint, lolos
 * dari pengecekan villa-api, dan lolos dari /availability — unit yang
 * sudah terisi bisa dibooking dua kali. Padahal form kasir sebelumnya
 * memberi nilai bawaan check-out = check-in, yaitu persis keadaan itu.
 *
 * Makanya validasi di bawah menolak check-out <= check-in, bukan sekadar
 * merapikan tampilan.
 */

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Tambah bulan dengan pemotongan akhir bulan: 31 Jan + 1 bulan = 28/29 Feb,
 * bukan 2/3 Maret seperti perilaku bawaan Date.setMonth.
 */
export function addMonthsISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/**
 * Jumlah malam, dihitung sama persis dengan villa-api POST /bookings
 * (`Math.max(1, round(selisih hari))`) supaya perkiraan yang dilihat kasir
 * tidak berbeda dari yang ditagihkan server.
 */
export function nightsBetween(checkin: string, checkout: string | null | undefined): number {
  if (!checkout) return 1;
  const a = new Date(`${checkin}T00:00:00Z`).getTime();
  const b = new Date(`${checkout}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}

/** Nilai bawaan check-out yang aman untuk tipe sewa tertentu. */
export function defaultCheckout(checkin: string, tipe: "harian" | "bulanan"): string {
  return tipe === "bulanan" ? addMonthsISO(checkin, 1) : addDaysISO(checkin, 1);
}

export interface StayRangeCheck {
  ok: boolean;
  message?: string;
}

export function validateStayRange(checkin: string, checkout: string): StayRangeCheck {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(checkin)) return { ok: false, message: "Tanggal check-in belum diisi dengan benar." };
  if (!iso.test(checkout)) return { ok: false, message: "Tanggal check-out belum diisi dengan benar." };
  if (checkout === checkin) {
    return {
      ok: false,
      message:
        "Check-out harus setelah check-in. Menginap 0 malam tidak bisa dicatat — booking seperti itu tidak mengunci unit, jadi unit yang sama masih bisa dibooking tamu lain.",
    };
  }
  if (checkout < checkin) return { ok: false, message: "Check-out tidak boleh lebih awal dari check-in." };
  return { ok: true };
}
