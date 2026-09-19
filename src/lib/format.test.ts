import { describe, expect, it } from "vitest";
import {
  fmtCurrency,
  fmtCurrencyFull,
  currentPeriod,
  todayISO,
  fmtDate,
  fmtDateTime,
  fmtTime,
  recentPeriods,
} from "./format";

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

  // Inti perubahan WIB: pukul 01:00 WIB tanggal 20 Sep adalah 18:00 UTC
  // tanggal 19 Sep. Versi lama (toISOString) menjawab "2026-09-19" --
  // tanggal KEMARIN -- untuk resepsionis shift malam.
  it("todayISO memakai kalender WIB, bukan UTC", () => {
    expect(todayISO(new Date("2026-09-19T18:00:00Z"))).toBe("2026-09-20");
    expect(todayISO(new Date("2026-09-19T16:59:00Z"))).toBe("2026-09-19");
  });

  it("currentPeriod ikut pindah bulan menurut WIB", () => {
    // 1 Okt 01:00 WIB = 30 Sep 18:00 UTC. Periode laporan harus Oktober.
    expect(currentPeriod(new Date("2026-09-30T18:00:00Z"))).toBe("2026-10");
  });
});

describe("fmtDate / fmtDateTime / fmtTime", () => {
  it("menampilkan jam dalam WIB dan memberinya label", () => {
    const utcSore = "2026-09-19T14:30:00Z"; // 21:30 WIB
    expect(fmtDateTime(utcSore)).toContain("WIB");
    expect(fmtDateTime(utcSore)).toContain("21");
    expect(fmtTime(utcSore)).toContain("21");
  });

  it("tanggal lewat tengah malam WIB ikut bergeser", () => {
    // 18:30 UTC 19 Sep = 01:30 WIB 20 Sep.
    expect(fmtDate("2026-09-19T18:30:00Z")).toContain("20");
  });

  it("tanggal polos (YYYY-MM-DD) tidak bergeser mundur", () => {
    expect(fmtDate("2026-09-20")).toContain("20");
  });

  it("nilai kosong/tidak valid jadi em dash, bukan Invalid Date", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDateTime("bukan tanggal")).toBe("—");
    expect(fmtTime(undefined)).toBe("—");
  });
});

describe("recentPeriods", () => {
  it("label dan period selalu menunjuk bulan yang sama", () => {
    // Bug lama: new Date(2026, 8, 1) di WIB = 31 Agu 17:00 UTC, sehingga
    // toISOString().slice(0,7) = "2026-08" sementara labelnya "September
    // 2026" -- investor membuka laporan bulan yang bukan dipilihnya.
    const rows = recentPeriods(3, new Date("2026-09-19T14:00:00Z"));
    expect(rows.map((r) => r.period)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(rows[0].label).toContain("September");
    expect(rows[1].label).toContain("Agustus");
  });

  it("mundur melewati batas tahun", () => {
    const rows = recentPeriods(3, new Date("2026-01-15T05:00:00Z"));
    expect(rows.map((r) => r.period)).toEqual(["2026-01", "2025-12", "2025-11"]);
  });

  it("memakai bulan WIB pada awal bulan dini hari", () => {
    // 30 Sep 18:00 UTC = 1 Okt 01:00 WIB.
    expect(recentPeriods(1, new Date("2026-09-30T18:00:00Z"))[0].period).toBe("2026-10");
  });
});
