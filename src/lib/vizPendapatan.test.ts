import { describe, expect, it } from "vitest";
import { batasRapi, indeksLabel, persen, rpRingkas, slotChannel, urutSlot, warnaChannel, WARNA_LAINNYA } from "./vizPendapatan";

describe("vizPendapatan", () => {
  it("warna mengikuti nama channel, bukan urutan", () => {
    expect(slotChannel("website")).toBe(0);
    expect(slotChannel("Booking.com")).toBe(1);
    expect(slotChannel("agoda")).toBe(2);
    expect(slotChannel("traveloka")).toBe(3);
    expect(slotChannel("investor")).toBe(4);
    expect(warnaChannel("walk-in")).toBe(WARNA_LAINNYA);
    expect(warnaChannel("")).toBe(WARNA_LAINNYA);
  });

  it("urut sesuai slot, Lainnya di akhir", () => {
    const r = urutSlot(["investor", "zeta", "booking.com", "alpha", "website"], (s) => s);
    expect(r).toEqual(["website", "booking.com", "investor", "alpha", "zeta"]);
  });

  it("batas sumbu rapi", () => {
    expect(batasRapi(0)).toBe(1);
    expect(batasRapi(7_300_000)).toBe(10_000_000);
    expect(batasRapi(1_800_000)).toBe(2_000_000);
    expect(batasRapi(2_100_000)).toBe(2_500_000);
    expect(batasRapi(4_000_000)).toBe(5_000_000);
    expect(batasRapi(1_000_000)).toBe(1_000_000);
  });

  it("rupiah ringkas", () => {
    expect(rpRingkas(1_500_000)).toBe("1,5 Jt");
    expect(rpRingkas(2_000_000)).toBe("2 Jt");
    expect(rpRingkas(850_000)).toBe("850 rb");
    expect(rpRingkas(2_000_000_000)).toBe("2 M");
    expect(rpRingkas(0)).toBe("0");
  });

  it("indeks label sumbu-x", () => {
    expect(indeksLabel(0)).toEqual([]);
    expect(indeksLabel(4)).toEqual([0, 1, 2, 3]);
    const l = indeksLabel(31);
    expect(l[0]).toBe(0);
    expect(l[l.length - 1]).toBe(30);
    expect(l.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < l.length; i++) expect(l[i] - l[i - 1]).toBeGreaterThanOrEqual(3);
  });

  it("persen", () => {
    expect(persen(1, 3)).toBe("33%");
    expect(persen(1, 500)).toBe("<1%");
    expect(persen(0, 10)).toBe("0%");
    expect(persen(5, 0)).toBe("0%");
  });
});
