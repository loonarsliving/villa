import { describe, it, expect } from "vitest";
import {
  addDaysISO,
  addMonthsISO,
  defaultCheckout,
  nightsBetween,
  todayLocalISO,
  validateStayRange,
} from "./stayDates";

describe("todayLocalISO", () => {
  it("pakai tanggal lokal perangkat, bukan UTC", () => {
    // 20 Sep 2026 pukul 01:00 WIB = 19 Sep 18:00 UTC. Resepsionis yang
    // check-in tamu jam 1 pagi harus dapat tanggal 20, bukan 19.
    const wibEarlyMorning = new Date("2026-09-19T18:00:00Z");
    expect(todayLocalISO(wibEarlyMorning)).toBe(
      `${wibEarlyMorning.getFullYear()}-${String(wibEarlyMorning.getMonth() + 1).padStart(2, "0")}-${String(
        wibEarlyMorning.getDate(),
      ).padStart(2, "0")}`,
    );
  });
});

describe("addDaysISO / addMonthsISO", () => {
  it("menambah hari melewati batas bulan", () => {
    expect(addDaysISO("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("memotong ke akhir bulan, bukan melompat ke bulan berikutnya", () => {
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsISO("2026-09-20", 1)).toBe("2026-10-20");
  });
});

describe("nightsBetween", () => {
  it("sama dengan hitungan villa-api POST /bookings", () => {
    expect(nightsBetween("2026-09-20", "2026-09-23")).toBe(3);
    expect(nightsBetween("2026-09-20", null)).toBe(1);
    // villa-api memakai Math.max(1, ...), jadi rentang kosong/terbalik
    // tetap ditagih 1 malam -- itulah sebabnya rentangnya divalidasi.
    expect(nightsBetween("2026-09-20", "2026-09-20")).toBe(1);
    expect(nightsBetween("2026-09-20", "2026-09-19")).toBe(1);
  });
});

describe("defaultCheckout", () => {
  it("tidak pernah mengembalikan tanggal yang sama dengan check-in", () => {
    expect(defaultCheckout("2026-09-20", "harian")).toBe("2026-09-21");
    expect(defaultCheckout("2026-09-20", "bulanan")).toBe("2026-10-20");
  });
});

describe("validateStayRange", () => {
  it("menolak menginap 0 malam -- lubang double-booking yang sebenarnya", () => {
    const r = validateStayRange("2026-09-20", "2026-09-20");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/0 malam/);
  });
  it("menolak check-out sebelum check-in", () => {
    expect(validateStayRange("2026-09-20", "2026-09-19").ok).toBe(false);
  });
  it("menolak tanggal kosong atau tidak berformat ISO", () => {
    expect(validateStayRange("", "2026-09-21").ok).toBe(false);
    expect(validateStayRange("2026-09-20", "20/09/2026").ok).toBe(false);
  });
  it("menerima rentang minimal satu malam", () => {
    expect(validateStayRange("2026-09-20", "2026-09-21").ok).toBe(true);
    expect(validateStayRange("2026-09-20", "2026-10-20").ok).toBe(true);
  });
});
