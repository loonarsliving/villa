import { describe, expect, it } from "vitest";

import { buildInvestorReportPdf, investorReportLines } from "./investorReportPdf";
import { toPdfSafe } from "./simplePdf";
import type { Report } from "./types";

const base: Report = {
  periode: "2026-09",
  gross_revenue: 100_000_000,
  opex_per_unit: 25_000_000,
  opex_pct: 0.25,
  marketing_pct: 0.275,
  marketing_amount: 27_500_000,
  gross_profit: 47_500_000,
  net: 47_500_000,
  owner_amount: 33_250_000,
  loonars_amount: 14_250_000,
  pengelola_amount: 14_250_000,
  jaminan_aktif: false,
  jaminan_topup: 0,
  per_investor_amount: 2_557_692,
  bagian_anda: 2_557_692,
  pemasukan_tetap: null,
};

function text(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
}

describe("investorReportLines", () => {
  it("menampilkan angka server apa adanya, termasuk Bagian Anda", () => {
    const lines = investorReportLines(base);
    expect(lines[0]).toMatchObject({ label: "Pendapatan Villa", value: "Rp 72.500.000" });
    expect(lines.map((l) => l.label).join(" ")).not.toMatch(/marketing/i);
    expect(lines.at(-1)).toMatchObject({ label: "Bagian Anda", value: "Rp 2.557.692" });
  });

  it("investor pemasukan tetap melihat angka tetapnya", () => {
    const lines = investorReportLines({ ...base, pemasukan_tetap: 5_000_000, bagian_anda: 5_000_000 });
    expect(lines.at(-1)?.label).toContain("Pemasukan Anda");
    expect(lines.at(-1)?.value).toBe("Rp 5.000.000");
  });
});

describe("investorReportLines rumus revenue - COGS - OPEX", () => {
  it("menampilkan COGS, Gross Profit, OPEX, lalu Net Profit", () => {
    const r: Report = {
      ...base,
      rumus: "revenue_cogs_opex_v2",
      revenue: 68_000_000,
      gross_revenue: 68_000_000,
      marketing_amount: 0,
      malam_terisi: 150,
      cogs_per_malam: 99_797,
      cogs: 14_969_550,
      gross_profit: 53_030_450,
      opex: 10_500_000,
      opex_per_unit: 10_500_000,
      net: 42_530_450,
    };
    const lines = investorReportLines(r);
    expect(lines.map((l) => l.label)).toEqual([
      "Pendapatan Villa",
      "COGS (biaya per kamar terisi)",
      "Gross Profit",
      "OPEX (gaji staf)",
      "Net Profit",
      "Pool Investor (70%)",
      "Loonars (30%)",
      "Bagian Anda",
    ]);
    expect(lines[0].value).toBe("Rp 68.000.000");
    expect(lines[1].value).toBe("- Rp 14.969.550");
    expect(lines[2].value).toBe("Rp 53.030.450");
    expect(lines[3].value).toBe("- Rp 10.500.000");
    expect(lines[4].value).toBe("Rp 42.530.450");
  });
});

describe("buildInvestorReportPdf", () => {
  it("menghasilkan PDF valid dengan xref yang menunjuk ke objek yang benar", () => {
    const pdf = text(
      buildInvestorReportPdf({ report: base, periodLabel: "September 2026", investorName: "Liza (A1)", unitLabel: "Unit A1", generatedAt: "11 Oktober 2026 17.00 WIB" }),
    );
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((off, i) => expect(pdf.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const len = Number(pdf.match(/\/Length (\d+)/)![1]);
    const streamStart = pdf.indexOf("stream\n") + "stream\n".length;
    expect(pdf.slice(streamStart + len, streamStart + len + "\nendstream".length)).toBe("\nendstream");
    expect(pdf).toContain("Liza \\(A1\\)");
    expect(pdf).toContain("Rp 2.557.692");
  });

  it("mengganti karakter di luar Latin-1 supaya offset tetap benar", () => {
    expect(toPdfSafe("A — B 🎉 é")).toBe("A - B ? é");
  });
});
