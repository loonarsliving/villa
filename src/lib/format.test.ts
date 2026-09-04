import { describe, expect, it } from "vitest";
import { fmtCurrency, fmtCurrencyFull, currentPeriod, todayISO } from "./format";

// Phase 0 test foundation. This repo had zero automated tests before this
// program started (see docs/revenue-engine/PHASE0-BASELINE.md). These
// cover the one shared formatting module that's actually safe to test
// today without touching any live/business-critical code path. Phase 1+
// adds real coverage for booking conflicts, pricing, and revenue metrics
// per the roadmap.

describe("fmtCurrency", () => {
  it("formats zero/null/undefined as Rp 0", () => {
    expect(fmtCurrency(0)).toBe("Rp 0");
    expect(fmtCurrency(null)).toBe("Rp 0");
    expect(fmtCurrency(undefined)).toBe("Rp 0");
  });

  it("formats sub-million amounts with Indonesian grouping", () => {
    expect(fmtCurrency(150000)).toBe("Rp 150.000");
  });

  it("formats million+ amounts in Jt shorthand", () => {
    expect(fmtCurrency(2500000)).toBe("Rp 2.5 Jt");
    expect(fmtCurrency(5000000)).toBe("Rp 5 Jt");
  });
});

describe("fmtCurrencyFull", () => {
  it("never uses Jt shorthand, even for large amounts", () => {
    expect(fmtCurrencyFull(5000000)).toBe("Rp 5.000.000");
  });

  it("treats null/undefined as 0", () => {
    expect(fmtCurrencyFull(null)).toBe("Rp 0");
  });
});

describe("currentPeriod / todayISO", () => {
  it("currentPeriod returns YYYY-MM", () => {
    expect(currentPeriod()).toMatch(/^\d{4}-\d{2}$/);
  });

  it("todayISO returns YYYY-MM-DD", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
