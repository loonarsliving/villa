import { describe, expect, it } from "vitest";
import { jamSingkat, kunciHari, labelHari, waktuDaftar } from "./chatFormat";

// 27 Sep 2026, 23.30 WIB (16.30 UTC)
const NOW = new Date("2026-09-27T16:30:00Z");

describe("kunciHari", () => {
  it("memakai kalender WIB, bukan UTC: 00.30 WIB tanggal 28 = 17.30 UTC tanggal 27", () => {
    expect(kunciHari("2026-09-27T17:30:00Z")).toBe("2026-09-28");
  });
});

describe("jamSingkat", () => {
  it("jam WIB tanpa label", () => {
    expect(jamSingkat("2026-09-27T14:30:52Z")).toBe("21.30");
  });
});

describe("labelHari", () => {
  it("hari ini, kemarin, dan tanggal lengkap untuk yang lebih lama", () => {
    expect(labelHari("2026-09-27T01:00:00Z", NOW)).toBe("Hari ini");
    expect(labelHari("2026-09-26T10:00:00Z", NOW)).toBe("Kemarin");
    expect(labelHari("2026-09-25T10:00:00Z", NOW)).toBe("25 Sep 2026");
  });
  it("jam 06.30 WIB tanggal 27 (23.30 UTC tanggal 26) tetap 'Hari ini'", () => {
    expect(labelHari("2026-09-26T23:30:00Z", NOW)).toBe("Hari ini");
  });
});

describe("waktuDaftar", () => {
  it("jam untuk hari ini, 'Kemarin', lalu tanggal pendek", () => {
    expect(waktuDaftar("2026-09-27T14:30:00Z", NOW)).toBe("21.30");
    expect(waktuDaftar("2026-09-26T14:30:00Z", NOW)).toBe("Kemarin");
    expect(waktuDaftar("2026-09-20T14:30:00Z", NOW)).toBe("20 Sep");
  });
});
