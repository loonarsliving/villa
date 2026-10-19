import { fmtCurrencyFull } from "./format";
import { A4_WIDTH, buildPdf, type PdfItem } from "./simplePdf";
import { alurBagiHasil } from "./investorPendapatan";
import type { Report } from "./types";

/**
 * PDF Laporan Bulanan untuk investor yang sedang login.
 *
 * Isinya sama persis dengan "Alur Bagi Hasil" di halaman Pendapatan
 * (alurBagiHasil): semua angka datang apa adanya dari GET /report
 * (dihitung di villa-api), tidak ada rumus yang dihitung ulang di sini. Untuk investor berskema pemasukan
 * tetap, baris terakhirnya "Pemasukan Anda" dengan angka tetapnya; jaminan
 * dan pembagian antar-investor tidak ditampilkan, sama seperti dashboard.
 */
export function investorReportLines(report: Report): { label: string; value: string; bold?: boolean }[] {
  return alurBagiHasil(report).map((b) => ({
    label: b.label,
    value: b.kurang ? `- ${fmtCurrencyFull(b.nilai)}` : fmtCurrencyFull(b.nilai),
    bold: b.tebal,
  }));
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
  items.push({ kind: "text", x: left, y, text: "Pendapatan - COGS = Gross Profit; Gross Profit - OPEX = Net Profit, dibagi 70:30.", size: 8.5 });

  return buildPdf(items);
}
