import { describe, expect, it } from "vitest";
import { statusSetelahSync, dibuatDiSini } from "./bookingStatusSync";

describe("statusSetelahSync", () => {
  // Kejadian nyata 2026-09-20 yang memunculkan modul ini.
  it("check-in dari meja depan tidak ditarik mundur oleh Cloudbeds", () => {
    expect(statusSetelahSync("checkin", "terjadwal")).toBe("checkin");
  });

  it("check-out tidak dibuka kembali oleh Cloudbeds", () => {
    expect(statusSetelahSync("checkout", "terjadwal")).toBe("checkout");
    expect(statusSetelahSync("checkout", "checkin")).toBe("checkout");
  });

  it("booking baru memakai status dari Cloudbeds", () => {
    expect(statusSetelahSync(null, "terjadwal")).toBe("terjadwal");
    expect(statusSetelahSync(undefined, "checkin")).toBe("checkin");
  });

  it("Cloudbeds masih boleh MENAIKKAN terjadwal jadi checkin", () => {
    expect(statusSetelahSync("terjadwal", "checkin")).toBe("checkin");
  });

  it("booking yang dibatalkan boleh dihidupkan lagi oleh Cloudbeds", () => {
    expect(statusSetelahSync("batal", "terjadwal")).toBe("terjadwal");
  });
});

describe("dibuatDiSini", () => {
  it("booking website dikenali dan dilindungi", () => {
    expect(dibuatDiSini("website", null)).toBe(true);
    expect(dibuatDiSini("cloudbeds", "[Website] Booking mandiri dari loonars.id")).toBe(true);
  });

  // Bug penanda lama: `sumber !== 'cloudbeds'` menganggap booking Agoda
  // sebagai milik kita, sehingga sync melewatinya sama sekali.
  it("booking OTA BUKAN milik kita, jadi tetap ikut disinkronkan", () => {
    for (const s of ["agoda", "booking.com", "airbnb", "tiket", "cloudbeds", "other"]) {
      expect(dibuatDiSini(s, null)).toBe(false);
    }
  });

  it("walk-in bukan booking website", () => {
    expect(dibuatDiSini("walk-in", null)).toBe(false);
  });

  // Kejadian nyata 2026-10-19: booking investor (Natalia, 639.000) dan KOL
  // (Atmojo, 603.000) ditimpa sync Cloudbeds -- sumber jadi 'cloudbeds',
  // harga Rp0 jadi harga penuh -- lalu check-in mencatat pemasukan penuh.
  it("booking berkupon investor dan KOL dikenali dan dilindungi", () => {
    expect(dibuatDiSini("investor", null)).toBe(true);
    expect(dibuatDiSini("kol", null)).toBe(true);
    expect(dibuatDiSini("cloudbeds", "[Menginap gratis investor] Kode XZBQ5T3S atas nama x")).toBe(true);
    expect(dibuatDiSini("cloudbeds", "[Menginap investor] Kode XZBQ5T3S")).toBe(true);
    expect(dibuatDiSini("cloudbeds", "[Kupon KOL] Kode KOL-CH3JWC untuk @atmojoae")).toBe(true);
  });

  it("kolom kupon tetap melindungi saat sumber dan catatan sudah tertimpa", () => {
    expect(dibuatDiSini("cloudbeds", "Baik — tidak ada kerusakan", { kol_voucher_id: "9c64b8ab" })).toBe(true);
    expect(dibuatDiSini("cloudbeds", null, { voucher_id: "abc" })).toBe(true);
    expect(dibuatDiSini("cloudbeds", null, { is_free_stay: true })).toBe(true);
  });

  it("booking OTA tanpa kupon tetap disinkronkan", () => {
    expect(dibuatDiSini("agoda", null, { is_free_stay: false, voucher_id: null, kol_voucher_id: null })).toBe(false);
    expect(dibuatDiSini("cloudbeds", null, null)).toBe(false);
  });
});
