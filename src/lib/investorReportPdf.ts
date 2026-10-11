import { fmtCurrencyFull } from "./format";
import { A4_WIDTH, buildPdf, type PdfItem } from "./simplePdf";
import type { Report } from "./types";

/**
 * PDF Laporan Bulanan untuk investor yang sedang login.
 *
 * Isinya sama persis dengan "Alur Bagi Hasil" di halaman Pendapatan: semua
 * angka datang apa adanya dari GET /report (dihitung di villa-api), tidak
 * ada rumus yang dihitung ulang di sini. Untuk investor berskema pemasukan
 * tetap, baris terakhirnya "Pemasukan Anda" dengan angka tetapnya; jaminan
 * dan pembagian antar-investor tidak ditampilkan, sama seperti dashboard.
 */
export function investorReportLines(report: Report): { label: string; value: string; bold?: boolean }[] {
  const g = report.gross_revenue || 0;
  const opexPct = Math.round((report.opex_pct ?? 0.25) * 100);
  const mkPct = Math.round((report.marketing_pct ?? 0.275) * 100);
  const net = report.net ?? report.gross_profit ?? 0;
  const pengelola = report.pengelola_amount ?? report.loonars_amount ?? 0;
  const tetap = report.pemasukan_tetap ?? null;
  const bagianAnda = report.bagian_anda ?? report.per_investor_amount ?? 0;

  return [
    { label: "Pendapatan Seluruh Villa", value: fmtCurrencyFull(g), bold: true },
    { label: `Opex (${opexPct}% dari omzet)`, value: `- ${fmtCurrencyFull(report.opex_per_unit)}` },
    { label: `Marketing (${mkPct}% dari omzet)`, value: `- ${fmtCurrencyFull(report.marketing_amount)}` },
    { label: "Net Profit", value: fmtCurrencyFull(net), bold: true },
    { label: "Pool Investor (70%)", value: fmtCurrencyFull(report.owner_amount) },
    { label: "Loonars (30%)", value: fmtCurrencyFull(pengelola) },
    tetap !== null
      ? { label: "Pemasukan Anda (tetap sesuai skema pembelian)", value: fmtCurrencyFull(bagianAnda), bold: true }
      : { label: "Bagian Anda", value: fmtCurrencyFull(bagianAnda), bold: true },
  ];
}

export function buildInvestorReportPdf(opts: {
  report: Report;
  periodLabel: string;
  investorName: string;
  unitLabel: string;
  generatedAt: string;
}): Uint8Array {
  const left = 56;
  const right = A4_WIDTH - 56;
  const items: PdfItem[] = [];
  let y = 780;

  items.push({ kind: "text", x: left, y, text: "LOONARS VILLA", size: 18, bold: true });
  y -= 22;
  items.push({ kind: "text", x: left, y, text: `Laporan Bulanan Investor - ${opts.periodLabel}`, size: 12 });
  y -= 14;
  items.push({ kind: "line", x1: left, x2: right, y, width: 1 });
  y -= 24;

  const meta: [string, string][] = [
    ["Investor", opts.investorName],
    ["Unit", opts.unitLabel],
    ["Periode", opts.periodLabel],
  ];
  for (const [k, v] of meta) {
    items.push({ kind: "text", x: left, y, text: k, size: 10 });
    items.push({ kind: "text", x: left + 90, y, text: `: ${v}`, size: 10 });
    y -= 16;
  }

  y -= 14;
  items.push({ kind: "text", x: left, y, text: "Alur Bagi Hasil", size: 12, bold: true });
  y -= 10;
  items.push({ kind: "line", x1: left, x2: right, y });
  y -= 18;

  for (const line of investorReportLines(opts.report)) {
    items.push({ kind: "text", x: left, y, text: line.label, size: 10.5, bold: line.bold });
    items.push({ kind: "text", x: right, y, text: line.value, size: 10.5, bold: line.bold, align: "right" });
    y -= 8;
    items.push({ kind: "line", x1: left, x2: right, y, width: 0.3 });
    y -= 16;
  }

  if (opts.report.pemasukan_tetap != null) {
    y -= 6;
    items.push({
      kind: "text",
      x: left,
      y,
      text: "Pemasukan Anda bernilai tetap setiap bulan dan tidak mengikuti alur bagi hasil di atas.",
      size: 9,
    });
    y -= 14;
  }

  y -= 10;
  items.push({ kind: "text", x: left, y, text: `Dicetak dari dashboard investor pada ${opts.generatedAt}.`, size: 8.5 });
  y -= 12;
  items.push({ kind: "text", x: left, y, text: "Angka dihitung oleh sistem Loonars sesuai akad yang berlaku.", size: 8.5 });

  return buildPdf(items);
}
