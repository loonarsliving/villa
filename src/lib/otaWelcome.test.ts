import { describe, expect, it } from "vitest";
import { dalamJamKirim } from "./otaWelcome";

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
