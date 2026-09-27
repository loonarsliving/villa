import { WIB_TIME_ZONE, todayISO } from "./format";

/** Kunci hari WIB "YYYY-MM-DD" -- dasar pemisah hari di percakapan. */
export function kunciHari(iso: string): string {
  return todayISO(new Date(iso));
}

function kemarinISO(now: Date): string {
  return todayISO(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/** Jam singkat WIB tanpa label, mis. "21.30" -- untuk gelembung pesan. */
export function jamSingkat(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", { timeZone: WIB_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
}

/** Pemisah hari: "Hari ini", "Kemarin", atau "25 Sep 2026" (WIB). */
export function labelHari(iso: string, now: Date = new Date()): string {
  const hari = kunciHari(iso);
  if (hari === todayISO(now)) return "Hari ini";
  if (hari === kemarinISO(now)) return "Kemarin";
  return new Date(iso).toLocaleDateString("id-ID", { timeZone: WIB_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
}

/** Waktu di daftar percakapan: jam kalau hari ini, "Kemarin", atau "25 Sep" (WIB). */
export function waktuDaftar(iso: string, now: Date = new Date()): string {
  const hari = kunciHari(iso);
  if (hari === todayISO(now)) return jamSingkat(iso);
  if (hari === kemarinISO(now)) return "Kemarin";
  return new Date(iso).toLocaleDateString("id-ID", { timeZone: WIB_TIME_ZONE, day: "numeric", month: "short" });
}
