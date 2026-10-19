import { describe, expect, it } from "vitest";
import { faktorBulan, hitungCogsStandar, hitungLabaRugi, payrollPeriode } from "./cogsStandar";

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
  const dasar = { totalKamar: 13, hariPeriode: 30, grossRevenue: 90_000_000, komisiOta: 10_229_776, netRevenue: 79_770_224, payroll: 10_500_000 };

  it("revenue - COGS standar = gross profit; gross profit - OPEX = net profit", () => {
    const r = hitungLabaRugi({ ...dasar, malamTerjual: 148 });
    expect(r.cogs).toBe(148 * 99_797);
    expect(r.grossProfit).toBe(79_770_224 - 148 * 99_797);
    expect(r.opex).toBe(10_500_000);
    expect(r.netProfit).toBe(r.grossProfit - 10_500_000);
  });

  it("tanpa pendapatan, margin kosong", () => {
    expect(hitungLabaRugi({ ...dasar, malamTerjual: 0, netRevenue: 0 }).grossMarginPct).toBeNull();
  });
});

describe("payrollPeriode", () => {
  it("total 7 staf = Rp10,5 jt sebulan penuh", () => {
    const p = payrollPeriode("2026-10-01", "2026-10-31");
    expect(p.reduce((s, x) => s + x.periode, 0)).toBe(10_500_000);
  });

  it("bulan berjalan diprorata per hari bulan itu, sama dengan villa-api", () => {
    const p = payrollPeriode("2026-10-01", "2026-10-19");
    expect(p.map((x) => x.periode)).toEqual([
      Math.round(3_000_000 * 19 / 31),
      Math.round(4_500_000 * 19 / 31),
      Math.round(3_000_000 * 19 / 31),
    ]);
  });

  it("sebelum villa beroperasi (20 Sep 2026) gaji tidak dihitung", () => {
    expect(payrollPeriode("2026-08-01", "2026-08-31").every((x) => x.periode === 0)).toBe(true);
    expect(payrollPeriode("2026-09-01", "2026-09-30").reduce((s, x) => s + x.periode, 0)).toBe(1_100_000 + 1_650_000 + 1_100_000);
  });

  it("rentang lintas bulan dijumlah per hari", () => {
    expect(faktorBulan("2026-09-01", "2026-10-31")).toBeCloseTo(2, 10);
  });
});
