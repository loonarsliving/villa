import { describe, expect, it } from "vitest";
import { dalamJamKirim, SUMBER_OTA_DISAMBUT } from "./otaWelcome";

describe("dalamJamKirim (08.00-21.00 WIB)", () => {
  it("07.59 WIB belum, 08.00 WIB sudah", () => {
    expect(dalamJamKirim(new Date("2026-09-28T00:59:00Z"))).toBe(false);
    expect(dalamJamKirim(new Date("2026-09-28T01:00:00Z"))).toBe(true);
  });
  it("20.59 WIB masih, 21.00 WIB tidak lagi, tengah malam tidak", () => {
    expect(dalamJamKirim(new Date("2026-09-28T13:59:00Z"))).toBe(true);
    expect(dalamJamKirim(new Date("2026-09-28T14:00:00Z"))).toBe(false);
    expect(dalamJamKirim(new Date("2026-09-28T17:00:00Z"))).toBe(false);
  });
});

describe("SUMBER_OTA_DISAMBUT (diperluas 2026-09-28: \"cloudbedsku banyak koneksinya\")", () => {
  it("mencakup OTA sungguhan yang sudah dipetakan mapSourceNameToSumber", () => {
    expect(SUMBER_OTA_DISAMBUT).toEqual(expect.arrayContaining(["agoda", "airbnb", "booking.com", "traveloka", "tiket"]));
    expect(SUMBER_OTA_DISAMBUT).toHaveLength(5);
  });
  it("TIDAK mencakup 'google' (metasearch, bukan kanal pembayaran) atau 'cloudbeds' (keranjang sourceName tak dikenal)", () => {
    expect(SUMBER_OTA_DISAMBUT).not.toContain("google");
    expect(SUMBER_OTA_DISAMBUT).not.toContain("cloudbeds");
  });
  it("TIDAK mencakup kanal non-OTA (tamu sudah punya kontak langsung)", () => {
    for (const bukanOta of ["website", "walk-in", "whatsapp", "other"]) {
      expect(SUMBER_OTA_DISAMBUT).not.toContain(bukanOta);
    }
  });
});
