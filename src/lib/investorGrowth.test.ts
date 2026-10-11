import { describe, expect, it } from "vitest";

import { buildGrowthRows } from "./investorGrowth";
import type { Report } from "./types";

const rep = (gross: number): Report =>
  ({ gross_revenue: gross, net: gross * 0.475, per_investor_amount: (gross * 0.475 * 0.7) / 13 }) as Report;

const months = [
  { period: "2026-10", label: "Oktober 2026" },
  { period: "2026-09", label: "September 2026" },
  { period: "2026-08", label: "Agustus 2026" },
  { period: "2026-07", label: "Juli 2026" },
];

describe("buildGrowthRows", () => {
  it("urut dari terlama, membuang bulan kosong di awal, tanpa persen untuk bulan berjalan", () => {
    const rows = buildGrowthRows(months, [rep(43_000_000), rep(20_000_000), rep(10_000_000), rep(0)], "2026-10");
    expect(rows.map((r) => r.period)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(rows[0].changePct).toBeNull();
    expect(rows[1].changePct).toBe(100);
    expect(rows[2].berjalan).toBe(true);
    expect(rows[2].changePct).toBeNull();
  });

  it("bulan gagal dimuat dianggap nol, bukan dilewati", () => {
    const rows = buildGrowthRows(months, [null, rep(20_000_000), null, rep(5_000_000)], "2026-11");
    expect(rows.map((r) => r.gross)).toEqual([5_000_000, 0, 20_000_000, 0]);
    expect(rows[2].changePct).toBeNull(); // bulan sebelumnya nol: tidak bisa dibandingkan
  });

  it("tanpa pendapatan sama sekali menghasilkan daftar kosong", () => {
    expect(buildGrowthRows(months, [rep(0), rep(0), null, null], "2026-10")).toEqual([]);
  });
});
