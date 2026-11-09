import { describe, expect, it } from "vitest";
import { aiResepsionisAktifUntuk, PENGETAHUAN_EL, PENGETAHUAN_TAMU_BOOKING, PENGETAHUAN_UMUM, pengetahuanProperti } from "./aiResepsionisPengetahuan";
import { nominalDalamTeks } from "./aiResepsionis";

describe("pengetahuanProperti", () => {
  it("PL tetap sama persis seperti sebelumnya", () => {
    expect(pengetahuanProperti("PL", false)).toBe(PENGETAHUAN_UMUM);
    expect(pengetahuanProperti("PL", true)).toBe(`${PENGETAHUAN_UMUM}\n\n${PENGETAHUAN_TAMU_BOOKING}`);
  });

  it("EL memakai pengetahuan EL, tanpa info villa PL", () => {
    const el = pengetahuanProperti("EL", true)!;
    expect(el).toBe(PENGETAHUAN_EL);
    expect(el).not.toContain("loonarsvilla");
    expect(el).not.toContain("Sawah View (sering");
    expect(el).toContain("TIDAK ADA sarapan gratis");
  });

  it("pengetahuan EL tidak memuat nominal uang (harga hanya dari sistem)", () => {
    expect(nominalDalamTeks(PENGETAHUAN_EL)).toEqual([]);
  });

  it("properti lain tidak dibuatkan draf", () => {
    expect(pengetahuanProperti("XYZ", false)).toBeNull();
    expect(aiResepsionisAktifUntuk("XYZ")).toBe(false);
    expect(aiResepsionisAktifUntuk("EL")).toBe(true);
    expect(aiResepsionisAktifUntuk("PL")).toBe(true);
    expect(aiResepsionisAktifUntuk(null)).toBe(true);
  });
});
