import type { Report } from "./types";

/**
 * Pendapatan villa yang ditampilkan ke investor: omzet SETELAH potongan
 * pemasaran/distribusi (komisi OTA dkk.).
 *
 * Owner 2026-10-11: "yg tertulis ya omset setelah potongan marketing, jadi
 * tidak perlu ditampilkan karena itu yang menyebabkan salah kaprah dari
 * investor". Baris "Marketing 27,5%" dulu terbaca sebagai biaya tambahan di
 * luar potongan OTA, padahal potongan itulah biaya OTA-nya.
 *
 * HANYA tampilan. Rumus bagi hasil di villa-api (computeReport, dibekukan di
 * docs/revenue-engine/PHASE0-BASELINE.md §2) tidak berubah:
 *   pendapatanInvestor = gross_revenue - marketing_amount
 *   net                = pendapatanInvestor - opex_per_unit   (sama persis)
 */
export function pendapatanInvestor(report: Report | null | undefined): number {
  if (!report) return 0;
  return (report.gross_revenue || 0) - (report.marketing_amount || 0);
}
