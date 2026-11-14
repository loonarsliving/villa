import { describe, expect, it } from "vitest";
import { agendaPerHari, akhirPekan, menginapMalam, posisiBatang, selisihHari, terisiPerHari } from "./kalenderBooking";
import type { Booking } from "./types";

const bk = (p: Partial<Booking>): Booking => ({
  id: p.id ?? "x",
  unit_id: p.unit_id ?? "u1",
  unit_nomor: p.unit_nomor ?? "A1",
  guest_nama: "T",
  tipe: "harian",
  status: p.status ?? "terjadwal",
  sumber: "website",
  tgl_checkin: p.tgl_checkin ?? "2026-11-14",
  tgl_checkout: p.tgl_checkout === undefined ? "2026-11-16" : p.tgl_checkout,
  tarif: 0,
  total_bayar: 0,
  created_at: "",
});

describe("posisiBatang", () => {
  it("mulai & selesai di tengah hari", () => {
    // rentang 10 hari mulai 14 Nov; 14 -> 16 Nov = dari 0.5 s/d 2.5 hari
    expect(posisiBatang(bk({}), "2026-11-14", 10)).toEqual({ kiri: 5, lebar: 20, potongKiri: false, potongKanan: false });
  });
  it("terpotong tepi kiri & kanan", () => {
    const p = posisiBatang(bk({ tgl_checkin: "2026-11-10", tgl_checkout: "2026-11-30" }), "2026-11-14", 10)!;
    expect(p.kiri).toBe(0);
    expect(p.lebar).toBe(100);
    expect(p.potongKiri).toBe(true);
    expect(p.potongKanan).toBe(true);
  });
  it("tanpa tanggal keluar = sampai akhir rentang", () => {
    expect(posisiBatang(bk({ tgl_checkout: null }), "2026-11-14", 4)!.lebar).toBe(87.5);
  });
  it("di luar rentang = null", () => {
    expect(posisiBatang(bk({ tgl_checkin: "2026-11-01", tgl_checkout: "2026-11-05" }), "2026-11-14", 7)).toBeNull();
  });
});

describe("okupansi & agenda", () => {
  const rows = [
    bk({ id: "a", unit_id: "u1", tgl_checkin: "2026-11-14", tgl_checkout: "2026-11-16" }),
    bk({ id: "b", unit_id: "u2", tgl_checkin: "2026-11-15", tgl_checkout: "2026-11-16", status: "checkin" }),
    bk({ id: "c", unit_id: "u3", tgl_checkin: "2026-11-14", tgl_checkout: "2026-11-15", status: "batal" }),
    bk({ id: "d", unit_id: "u1", tgl_checkin: "2026-11-16", tgl_checkout: "2026-11-17" }),
  ];
  const hari = ["2026-11-14", "2026-11-15", "2026-11-16"];
  it("menginapMalam", () => {
    expect(menginapMalam(rows[0], "2026-11-15")).toBe(true);
    expect(menginapMalam(rows[0], "2026-11-16")).toBe(false);
    expect(menginapMalam(rows[2], "2026-11-14")).toBe(false);
  });
  it("terisi per malam (unit unik)", () => {
    expect(terisiPerHari(rows, hari)).toEqual([1, 2, 1]);
  });
  it("agenda datang/pulang", () => {
    const a = agendaPerHari(rows, hari);
    expect(a[0].datang.map((b) => b.id)).toEqual(["a"]);
    expect(a[2].pulang.map((b) => b.id).sort()).toEqual(["a", "b"]);
    expect(a[2].datang.map((b) => b.id)).toEqual(["d"]);
  });
  it("lain-lain", () => {
    expect(selisihHari("2026-11-14", "2026-11-16")).toBe(2);
    expect(akhirPekan("2026-11-14")).toBe(true); // Sabtu
    expect(akhirPekan("2026-11-16")).toBe(false); // Senin
  });
});
