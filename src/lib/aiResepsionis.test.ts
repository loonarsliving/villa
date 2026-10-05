import { describe, expect, it } from "vitest";
import { angkaTidakDikenal, nominalDalamTeks, waktuWib } from "./aiResepsionis";
import { PENGETAHUAN_UMUM } from "./aiResepsionisPengetahuan";

describe("nominalDalamTeks", () => {
  it("mengenali bentuk nominal yang dipakai resepsionis", () => {
    expect(nominalDalamTeks("diharga Rp.706.000 dan Rp 1.100.000")).toEqual([706000, 1100000]);
    expect(nominalDalamTeks("paket 250k untuk 3-4 orang")).toEqual([250000]);
    expect(nominalDalamTeks("biaya 100 ribu")).toEqual([100000]);
    expect(nominalDalamTeks("sekitar 1,1 jt")).toEqual([1100000]);
    expect(nominalDalamTeks("view sawah di 662.000 permalam")).toEqual([662000]);
  });

  it("jam, tanggal, dan angka polos bukan nominal", () => {
    expect(nominalDalamTeks("Check-in pukul 15.00, check-out 12.00")).toEqual([]);
    expect(nominalDalamTeks("tanggal 10-11 Oktober 2026, 2 orang, unit A2")).toEqual([]);
  });
});

describe("angkaTidakDikenal", () => {
  it("menahan harga paket yang dikarang AI", () => {
    expect(angkaTidakDikenal("Paket grill kami Rp250.000 ya Kak", [PENGETAHUAN_UMUM], [])).toEqual([250000]);
  });

  it("meloloskan biaya early check-in dari pengetahuan dan harga dari sistem", () => {
    expect(angkaTidakDikenal("Early check-in Rp100.000 ya Kak", [PENGETAHUAN_UMUM], [])).toEqual([]);
    expect(angkaTidakDikenal("Late check-out dikenakan 100 ribu per jam ya Kak", [PENGETAHUAN_UMUM], [])).toEqual([]);
    expect(angkaTidakDikenal("Standard Rp706.000/malam, total Rp1.412.000", [PENGETAHUAN_UMUM], [706000, 1412000])).toEqual([]);
  });

  it("total late check-out yang dihitung AI sendiri ditahan", () => {
    expect(angkaTidakDikenal("Sampai jam 14.00 jadi Rp200.000 ya Kak", [PENGETAHUAN_UMUM], [])).toEqual([200000]);
  });

  it("harga sistem yang dibulatkan AI tetap ditahan", () => {
    expect(angkaTidakDikenal("Standard sekitar 700k/malam", [PENGETAHUAN_UMUM], [706000])).toEqual([700000]);
  });
});

describe("waktuWib", () => {
  it("UTC+7 dengan nama hari", () => {
    expect(waktuWib(new Date("2026-10-05T07:03:00Z"))).toBe("2026-10-05 14:03 (Senin)");
    expect(waktuWib(new Date("2026-10-04T18:30:00Z"))).toBe("2026-10-05 01:30 (Senin)");
  });
});
