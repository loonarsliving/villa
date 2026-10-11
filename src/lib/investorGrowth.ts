import type { Report } from "./types";

/**
 * Baris halaman Pertumbuhan Loonars. Semua angka diambil apa adanya dari
 * GET /report (dihitung villa-api); yang dihitung di sini hanya persen
 * perubahan antar-bulan, bukan rumus bagi hasil.
 */
export type GrowthRow = {
  period: string;
  label: string;
  gross: number;
  net: number;
  /** Bagian per unit bila murni 70:30 dari profit (per_investor_amount dari villa-api). */
  perUnit: number;
  /** Persen perubahan pendapatan dibanding bulan sebelumnya; null kalau tidak bisa dibandingkan. */
  changePct: number | null;
  berjalan: boolean;
};

/**
 * Bulan disusun dari yang terlama. Bulan-bulan awal tanpa pendapatan sama
 * sekali (sebelum villa beroperasi penuh) dibuang supaya grafik tidak dibuka
 * dengan deretan nol. Bulan berjalan tidak diberi persen perubahan: angka
 * setengah bulan dibanding bulan penuh hanya akan terlihat seperti turun.
 */
export function buildGrowthRows(
  months: { period: string; label: string }[],
  reports: (Report | null)[],
  currentPeriod: string,
): GrowthRow[] {
  const rows = months
    .map((m, i) => ({ m, r: reports[i] }))
    .sort((a, b) => a.m.period.localeCompare(b.m.period));

  const first = rows.findIndex(({ r }) => (r?.gross_revenue ?? 0) > 0);
  if (first < 0) return [];

  const out: GrowthRow[] = [];
  for (const { m, r } of rows.slice(first)) {
    const gross = r?.gross_revenue ?? 0;
    const prev = out.at(-1);
    const berjalan = m.period === currentPeriod;
    out.push({
      period: m.period,
      label: m.label,
      gross,
      net: r?.net ?? r?.gross_profit ?? 0,
      perUnit: r?.per_investor_amount ?? 0,
      changePct: !berjalan && prev && prev.gross > 0 ? ((gross - prev.gross) / prev.gross) * 100 : null,
      berjalan,
    });
  }
  return out;
}
