import { describe, expect, it } from "vitest";
import { lebarCode128B, POLA_CODE128, simbolCode128B } from "./barcode128";

describe("Code 128B", () => {
  it("tabel pola lengkap dan setiap pola 11 modul (stop 13)", () => {
    expect(POLA_CODE128).toHaveLength(107);
    POLA_CODE128.forEach((p, i) => {
      const jml = Array.from(p, Number).reduce((a, b) => a + b, 0);
      expect(jml).toBe(i === 106 ? 13 : 11);
    });
  });

  it("checksum dihitung sesuai aturan Code 128 (\"PJJ123C\" -> 55)", () => {
    // 104 + 48*1 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7 = 879; 879 mod 103 = 55.
    const s = simbolCode128B("PJJ123C");
    expect(s[0]).toBe(104);
    expect(s[s.length - 2]).toBe(55);
    expect(s[s.length - 1]).toBe(106);
  });

  it("nomor anggota kartu menghasilkan batang bergantian dengan panjang benar", () => {
    const w = lebarCode128B("PI-3F9A1C");
    // start + 9 karakter + checksum = 11 simbol x 6 elemen, stop 7 elemen
    expect(w).toHaveLength(11 * 6 + 7);
    expect(w.reduce((a, b) => a + b, 0)).toBe(11 * 11 + 13);
  });

  it("menolak karakter di luar set B", () => {
    expect(() => simbolCode128B("é")).toThrow();
  });
});
