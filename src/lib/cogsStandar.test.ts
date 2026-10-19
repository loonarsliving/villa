import { describe, expect, it } from "vitest";
import { hitungCogsStandar, hitungLabaRugi } from "./cogsStandar";

describe("hitungCogsStandar", () => {
  it("13 kamar, okupansi 37,9% -> 148 malam, alokasi Rp34.797, COGS Rp99.797/malam", () => {
    const s = hitungCogsStandar(13);
    expect(s.malamStandarPerBulan).toBe(148);
    expect(s.biayaLangsungPerMalam).toBe(65_000);
    expect(s.biayaTetapPerBulan).toBe(5_150_000);
    expect(s.alokasiTetapPerMalam).toBe(34_797);
    expect(s.cogsPerMalam).toBe(99_797);
  });

  it("0 kamar tidak membagi dengan nol", () => {
    expect(hitungCogsStandar(0).alokasiTetapPerMalam).toBe(0);
  });
});

describe("hitungLabaRugi", () => {
  const dasar = { totalKamar: 13, hariPeriode: 30, grossRevenue: 90_000_000, komisiOta: 10_229_776, netRevenue: 79_770_224, payroll: 7_500_000 };

  it("tepat di okupansi standar: biaya tetap terserap penuh (selisih pembulatan saja)", () => {
    const r = hitungLabaRugi({ ...dasar, malamTerjual: 148 });
    expect(r.cogs).toBe(148 * 99_797);
    expect(r.grossProfit).toBe(79_770_224 - 148 * 99_797);
    expect(Math.abs(r.biayaTetapBelumTerserap)).toBeLessThan(100);
    expect(r.netProfit).toBe(r.grossProfit - 7_500_000 - r.biayaTetapBelumTerserap);
  });

  it("di bawah standar: sisa biaya tetap masuk OPEX sehingga total biaya = biaya aktual", () => {
    const r = hitungLabaRugi({ ...dasar, malamTerjual: 100 });
    expect(r.biayaTetapBelumTerserap).toBe(5_150_000 - 100 * 34_797);
    // Net profit = net revenue - biaya langsung - biaya tetap aktual - payroll
    expect(r.netProfit).toBe(79_770_224 - 100 * 65_000 - 5_150_000 - 7_500_000);
  });

  it("periode sebagian bulan memprorata biaya tetap", () => {
    const r = hitungLabaRugi({ ...dasar, hariPeriode: 15, malamTerjual: 0, netRevenue: 0 });
    expect(r.biayaTetapAktual).toBe(2_575_000);
    expect(r.grossMarginPct).toBeNull();
  });
});
