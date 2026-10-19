import { describe, expect, it } from "vitest";

import { pendapatanInvestor } from "./investorPendapatan";
import type { Report } from "./types";

describe("pendapatanInvestor", () => {
  it("villa-api versi lama: omzet setelah potongan pemasaran", () => {
    const r = { gross_revenue: 100_000_000, marketing_amount: 27_500_000, opex_per_unit: 25_000_000, net: 47_500_000 } as Report;
    expect(pendapatanInvestor(r)).toBe(72_500_000);
    expect(pendapatanInvestor(r) - r.opex_per_unit).toBe(r.net);
  });

  it("rumus baru: revenue apa adanya dari villa-api", () => {
    const r = { revenue: 68_000_000, gross_revenue: 68_000_000, marketing_amount: 0, opex_per_unit: 10_500_000, net: 42_000_000 } as Report;
    expect(pendapatanInvestor(r)).toBe(68_000_000);
  });

  it("tanpa laporan = 0", () => {
    expect(pendapatanInvestor(null)).toBe(0);
  });
});
