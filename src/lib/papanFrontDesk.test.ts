import { describe, expect, it } from "vitest";
import { cocokCari, jumlahMalam, susunPapan, tautanWa } from "./papanFrontDesk";
import type { Booking } from "./types";

const H = "2026-11-14";
const bk = (p: Partial<Booking>): Booking => ({
  id: p.id ?? Math.random().toString(36),
  unit_id: p.unit_id ?? "u-" + (p.unit_nomor ?? "x"),
  unit_nomor: p.unit_nomor ?? "A1",
  guest_nama: p.guest_nama ?? "Tamu",
  tipe: "harian",
  status: p.status ?? "terjadwal",
  sumber: "website",
  tgl_checkin: p.tgl_checkin ?? H,
  tgl_checkout: p.tgl_checkout === undefined ? "2026-11-15" : p.tgl_checkout,
  tarif: 0,
  total_bayar: 0,
  created_at: "",
  guest_hp: p.guest_hp ?? null,
});

describe("susunPapan", () => {
  const rows = [
    bk({ id: "a", unit_nomor: "A1", status: "terjadwal" }), // datang hari ini, belum
    bk({ id: "b", unit_nomor: "A2", status: "checkin" }), // datang hari ini, sudah
    bk({ id: "c", unit_nomor: "A3", status: "terjadwal", tgl_checkin: "2026-11-13", tgl_checkout: "2026-11-16" }), // terlambat
    bk({ id: "d", unit_nomor: "B1", status: "checkin", tgl_checkin: "2026-11-12", tgl_checkout: H }), // pulang, belum
    bk({ id: "e", unit_nomor: "B2", status: "checkout", tgl_checkin: "2026-11-12", tgl_checkout: H }), // pulang, sudah
    bk({ id: "f", unit_nomor: "B3", status: "terjadwal", tgl_checkin: "2026-11-13", tgl_checkout: H }), // tidak datang
    bk({ id: "g", unit_nomor: "C1", status: "checkin", tgl_checkin: "2026-11-12", tgl_checkout: "2026-11-17" }), // menginap
    bk({ id: "h", unit_nomor: "C2", status: "batal" }),
  ];
  const p = susunPapan(rows, H);

  it("tamu datang: terlambat & belum di atas, sudah di bawah", () => {
    expect(p.datang.map((d) => d.bk.id)).toEqual(["c", "a", "b"]);
    expect(p.datang[0].terlambat).toBe(true);
    expect(p.datang[2].selesai).toBe(true);
  });

  it("tamu pulang: tanpa 'tidak datang', belum di atas", () => {
    expect(p.pulang.map((d) => d.bk.id)).toEqual(["d", "e"]);
    expect(p.pulang[1].selesai).toBe(true);
  });

  it("peta per unit", () => {
    expect([...p.penghuni.keys()].sort()).toEqual(["u-A2", "u-B1", "u-C1"]);
    expect([...p.datangPerUnit.keys()].sort()).toEqual(["u-A1", "u-A3"]);
    expect([...p.pulangPerUnit.keys()]).toEqual(["u-B1"]);
  });
});

describe("helper", () => {
  it("cocokCari", () => {
    const b = { guest_nama: "Rina Kartika", unit_nomor: "B4", guest_hp: "0812-3456-7890" };
    expect(cocokCari(b, "")).toBe(true);
    expect(cocokCari(b, "rina")).toBe(true);
    expect(cocokCari(b, "b4")).toBe(true);
    expect(cocokCari(b, "34567")).toBe(true);
    expect(cocokCari(b, "12")).toBe(false);
    expect(cocokCari(b, "budi")).toBe(false);
  });
  it("tautanWa", () => {
    expect(tautanWa("0812 3456 789")).toBe("https://wa.me/628123456789");
    expect(tautanWa("+62 812 3456 789")).toBe("https://wa.me/628123456789");
    expect(tautanWa("12")).toBeNull();
    expect(tautanWa(null)).toBeNull();
  });
  it("jumlahMalam", () => {
    expect(jumlahMalam("2026-11-14", "2026-11-16")).toBe(2);
    expect(jumlahMalam("2026-11-14", null)).toBeNull();
  });
});
