import { describe, expect, it } from "vitest";
import { pecahAngka } from "./AnimatedValue";

describe("pecahAngka", () => {
  it("memecah rupiah bertitik ribuan", () => {
    expect(pecahAngka("Rp 1.250.000")).toEqual({ awal: "Rp ", angka: 1250000, akhir: "", bertitik: true });
  });
  it("memecah persen dan angka polos", () => {
    expect(pecahAngka("85%")?.angka).toBe(85);
    expect(pecahAngka("12")?.angka).toBe(12);
    expect(pecahAngka("-Rp 500.000")).toMatchObject({ awal: "-Rp ", angka: 500000 });
  });
  it("menolak teks dengan lebih dari satu angka atau tanpa angka", () => {
    expect(pecahAngka("12/15")).toBeNull();
    expect(pecahAngka("Rp 1,2 jt")).toBeNull();
    expect(pecahAngka("12,5%")).toBeNull();
    expect(pecahAngka("—")).toBeNull();
  });
  it("tidak menambah titik pada angka tanpa pemisah (mis. tahun 2026)", () => {
    expect(pecahAngka("2026")?.bertitik).toBe(false);
  });
});
