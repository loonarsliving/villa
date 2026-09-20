/**
 * Semua tanggal dan jam di aplikasi ini ditampilkan dalam WIB.
 *
 * Villa berada di Jalan Palagan, Sleman, Yogyakarta — zona waktu
 * Asia/Jakarta (WIB, UTC+7). Sebelumnya modul ini tidak menyebut zona waktu
 * sama sekali, jadi hasilnya tergantung pengaturan perangkat yang dipakai:
 * HP resepsionis yang zona waktunya salah, laptop owner yang sedang di luar
 * negeri, atau browser yang memakai UTC akan menampilkan jam yang berbeda
 * untuk kejadian yang sama. Padahal jam di layar ini dipakai untuk
 * keputusan nyata — denda check-out terlambat dihitung dari pukul 12:00 WIB
 * (lihat tata tertib di CheckinCard).
 *
 * `todayISO()` dan `currentPeriod()` lebih parah lagi: keduanya memakai
 * tanggal UTC, jadi antara pukul 00:00–07:00 WIB mereka masih menjawab
 * tanggal KEMARIN. Resepsionis shift malam yang membuka form check-in jam 1
 * pagi mendapat tanggal kemarin sebagai nilai bawaan.
 */
export const WIB_TIME_ZONE = "Asia/Jakarta";

export function fmtCurrency(n: number | null | undefined): string {
  if (!n) return "Rp 0";
  if (n >= 1e6) return "Rp " + (n / 1e6).toFixed(1).replace(".0", "") + " Jt";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

export function fmtCurrencyFull(n: number | null | undefined): string {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

export function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", { timeZone: WIB_TIME_ZONE, ...(opts ?? { day: "2-digit", month: "short" }) });
}

/**
 * Tanggal + jam, selalu WIB dan selalu diberi label "WIB" supaya tidak ada
 * yang perlu menebak jam siapa yang sedang dibaca.
 */
export function fmtDateTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // dateStyle/timeStyle tidak boleh dicampur dengan day/month/hour/minute --
  // Intl melempar TypeError kalau keduanya ada. Jadi kalau pemanggil memakai
  // gaya ringkas itu, bawaannya tidak ikut disertakan.
  const pakaiStyle = opts?.dateStyle != null || opts?.timeStyle != null;
  const base: Intl.DateTimeFormatOptions = pakaiStyle
    ? {}
    : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
  const text = d.toLocaleString("id-ID", { timeZone: WIB_TIME_ZONE, ...base, ...opts });
  return `${text} WIB`;
}

/** Hanya jam, WIB, mis. "14.05 WIB". */
export function fmtTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const text = d.toLocaleTimeString("id-ID", {
    timeZone: WIB_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  });
  return `${text} WIB`;
}

export function initials(name: string | null | undefined): string {
  return (name || "?").trim().charAt(0).toUpperCase();
}

/**
 * "YYYY-MM-DD" menurut kalender WIB.
 *
 * en-CA dipilih karena satu-satunya locale umum yang memformat tanggal
 * persis sebagai YYYY-MM-DD, sehingga hasilnya bisa langsung dibandingkan
 * sebagai string dengan kolom tanggal di database.
 */
export function todayISO(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: WIB_TIME_ZONE });
}

/** "YYYY-MM" menurut kalender WIB — periode laporan bulanan. */
export function currentPeriod(d: Date = new Date()): string {
  return todayISO(d).slice(0, 7);
}

export function periodLabel(d: Date = new Date()): string {
  return d.toLocaleDateString("id-ID", { timeZone: WIB_TIME_ZONE, month: "long", year: "numeric" });
}

/** Tanggal lengkap berbahasa Indonesia, mis. "Sabtu, 19 September 2026". */
export function fmtFullDate(d: Date = new Date()): string {
  return d.toLocaleDateString("id-ID", {
    timeZone: WIB_TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Daftar `n` periode bulanan terakhir (terbaru dulu) menurut kalender WIB.
 *
 * Dulu halaman laporan menyusunnya dengan `new Date(tahun, bulan - i, 1)`
 * lalu `toISOString().slice(0, 7)`. Tanggal 1 pukul 00:00 WIB adalah tanggal
 * terakhir bulan SEBELUMNYA dalam UTC, jadi labelnya tertulis "September
 * 2026" sementara periode yang dikirim ke API adalah "2026-08" — investor
 * membaca laporan bulan yang berbeda dari yang dipilihnya. Perhitungan di
 * bawah murni aritmetika tahun/bulan sehingga tidak bisa bergeser.
 */
export function recentPeriods(n: number, from: Date = new Date()): { period: string; label: string }[] {
  const [year, month] = currentPeriod(from).split("-").map(Number);
  const out: { period: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const total = year * 12 + (month - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    out.push({
      period: `${y}-${String(m).padStart(2, "0")}`,
      label: new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString("id-ID", {
        timeZone: WIB_TIME_ZONE,
        month: "long",
        year: "numeric",
      }),
    });
  }
  return out;
}
