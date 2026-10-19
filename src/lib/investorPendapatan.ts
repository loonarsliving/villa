import { fmtCurrencyFull } from "./format";
import type { Report } from "./types";

/**
 * Pendapatan villa yang ditampilkan ke investor: uang yang benar-benar
 * diterima villa setelah komisi OTA. Harga sebelum potongan OTA tidak
 * pernah ditampilkan ke investor (owner 2026-10-11 dan 2026-10-19).
 *
 * Sejak 2026-10-19 villa-api mengirim `revenue` (rumus revenue - COGS -
 * OPEX). Cadangan `gross_revenue - marketing_amount` hanya untuk villa-api
 * versi lama selama deploy berlangsung.
 */
export function pendapatanInvestor(report: Report | null | undefined): number {
  if (!report) return 0;
  if (report.revenue != null) return report.revenue;
  return (report.gross_revenue || 0) - (report.marketing_amount || 0);
}

export interface BarisBagiHasil {
  label: string;
  nilai: number;
  /** Tampil sebagai "- Rp ...". */
  kurang?: boolean;
  tebal?: boolean;
  emas?: boolean;
  keterangan?: string;
}

/**
 * Alur bagi hasil untuk halaman Pendapatan dan PDF laporan -- satu sumber
 * supaya keduanya selalu sama. Semua angka apa adanya dari GET /report.
 */
export function alurBagiHasil(report: Report): BarisBagiHasil[] {
  const pendapatan = pendapatanInvestor(report);
  const net = report.net ?? report.gross_profit ?? 0;
  const pengelola = report.pengelola_amount ?? report.loonars_amount ?? 0;
  const tetap = report.pemasukan_tetap ?? null;
  const bagianAnda = report.bagian_anda ?? report.per_investor_amount ?? 0;

  const baris: BarisBagiHasil[] = [
    { label: "Pendapatan Villa", nilai: pendapatan, tebal: true, keterangan: "Uang yang benar-benar diterima villa" },
  ];
  if (report.cogs != null) {
    baris.push(
      {
        label: "COGS (biaya per kamar terisi)",
        nilai: report.cogs,
        kurang: true,
        keterangan: `${fmtCurrencyFull(report.cogs_per_malam)} x ${report.malam_terisi ?? 0} malam`,
      },
      { label: "Gross Profit", nilai: report.gross_profit, tebal: true },
      { label: "OPEX (gaji staf)", nilai: report.opex ?? report.opex_per_unit, kurang: true },
    );
  } else {
    baris.push({ label: "Opex", nilai: report.opex_per_unit, kurang: true });
  }
  baris.push(
    { label: "Net Profit", nilai: net, tebal: true, keterangan: "Dasar pembagian 70:30" },
    { label: "Pool Investor (70%)", nilai: report.owner_amount, emas: true },
    { label: "Loonars (30%)", nilai: pengelola },
    tetap !== null
      ? { label: "Pemasukan Anda (tetap sesuai skema pembelian)", nilai: bagianAnda, tebal: true, emas: true }
      : { label: "Bagian Anda", nilai: bagianAnda, tebal: true, emas: true },
  );
  return baris;
}
