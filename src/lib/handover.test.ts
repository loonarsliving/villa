import { describe, expect, it } from "vitest";

import { buildHandover, handoverText, rentangTanggal, type HandoverBooking } from "./handover";

const bk = (o: Partial<HandoverBooking>): HandoverBooking => ({
  id: Math.random().toString(36), unit_id: "u", unit_nomor: "A1", guest_nama: "Tamu",
  tgl_checkin: "2026-10-12", tgl_checkout: "2026-10-14", status: "checkin", ...o,
});

describe("buildHandover", () => {
  const hari = "2026-10-13";
  it("memilah in house, check-out, dan check-in seperti laporan manual", () => {
    const h = buildHandover([
      bk({ guest_nama: "Dia Feselia", unit_nomor: "A1" }),
      bk({ guest_nama: "Ayu Nurhalizah", unit_nomor: "A5" }),
      bk({ guest_nama: "Dandi", unit_nomor: "A2", tgl_checkout: hari }),
      bk({ guest_nama: "Sasqia", unit_nomor: "B3", tgl_checkout: hari, status: "checkout" }),
      bk({ guest_nama: "Wahyu", unit_nomor: "A2", tgl_checkin: hari, tgl_checkout: "2026-10-15", status: "terjadwal" }),
      bk({ guest_nama: "Batal", unit_nomor: "C2", tgl_checkin: hari, status: "batal" }),
      bk({ guest_nama: "Belum bayar", unit_nomor: "C3", tgl_checkin: hari, status: "menunggu_pembayaran" }),
    ], hari);
    expect(h.inHouse.map((b) => b.guest_nama)).toEqual(["Dia Feselia", "Ayu Nurhalizah"]);
    expect(h.checkout.map((b) => [b.guest_nama, b.keadaan])).toEqual([["Dandi", "Belum check-out"], ["Sasqia", "Sudah check-out"]]);
    expect(h.checkin.map((b) => [b.guest_nama, b.keadaan])).toEqual([["Wahyu", "Belum datang"]]);
  });

  it("menandai tamu terlambat dan tidak datang", () => {
    const h = buildHandover([
      bk({ guest_nama: "Telat", status: "terjadwal" }),
      bk({ guest_nama: "NoShow", tgl_checkout: hari, status: "terjadwal" }),
      bk({ guest_nama: "Pulang awal", status: "checkout" }),
    ], hari);
    expect(h.inHouse.map((b) => b.keadaan)).toEqual(["Terlambat, belum datang"]);
    expect(h.checkout[0].keadaan).toBe("Tidak datang");
  });

  it("mengurutkan unit secara alami", () => {
    const h = buildHandover([bk({ unit_nomor: "C1" }), bk({ unit_nomor: "A10" }), bk({ unit_nomor: "A2" })], hari);
    expect(h.inHouse.map((b) => b.unit_nomor)).toEqual(["A2", "A10", "C1"]);
  });
});

describe("rentangTanggal & handoverText", () => {
  it("memformat tanggal seperti laporan WA", () => {
    expect(rentangTanggal("2026-10-12", "2026-10-14")).toBe("12-14 Okt");
    expect(rentangTanggal("2026-10-30", "2026-11-02")).toBe("30 Okt - 2 Nov");
  });
  it("membuat teks siap tempel", () => {
    const t = handoverText(buildHandover([bk({ guest_nama: "Dia", unit_nomor: "A1", paket_dekorasi: "Honeymoon Medium" })], "2026-10-13"), "Sel, 13 Okt");
    expect(t).toContain("*Menginap (lanjut)*\nTanggal 12-14 Okt\nDia (A1)\n🎉 Honeymoon Medium");
    expect(t).toContain("*Check-in hari ini*\n-");
  });
});
