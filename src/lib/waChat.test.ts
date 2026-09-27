import { describe, expect, it } from "vitest";
import { menyebutSewaVilla, pilihBookingTerbaik } from "./waChat";

describe("menyebutSewaVilla", () => {
  it("teks otomatis tombol Private Living di loonars.id lolos", () => {
    expect(menyebutSewaVilla("Halo, saya ingin tanya soal booking Loonars Private Living Yogyakarta")).toBe(true);
    expect(menyebutSewaVilla("Halo, saya ada pertanyaan soal menginap di Loonars Living Yogyakarta")).toBe(true);
    expect(menyebutSewaVilla("Halo, saya ingin booking Loonars Private Living Yogyakarta")).toBe(true);
    expect(menyebutSewaVilla("Halo Loonars Private Living! Saya baru saja booking:\nUnit: A2")).toBe(true);
  });
  it("pertanyaan menginap yang diketik sendiri lolos", () => {
    expect(menyebutSewaVilla("kak mau nginep tgl 5-7 bisa?")).toBe(true);
    expect(menyebutSewaVilla("harga per malam berapa ya")).toBe(true);
    expect(menyebutSewaVilla("Mau sewa villa buat staycation")).toBe(true);
  });
  it("produk properti yang dijual TIDAK lolos walau menyebut villa/living/booking", () => {
    expect(menyebutSewaVilla("Halo, saya tertarik Loonars Excellent Living")).toBe(false);
    expect(menyebutSewaVilla("Halo, saya ingin info Loonars Excellent Living")).toBe(false);
    expect(menyebutSewaVilla("Rumah tipe villa masih ada? booking fee berapa?")).toBe(false);
    expect(menyebutSewaVilla("Halo, saya ingin tahu lebih lanjut tentang produk Loonars")).toBe(false);
  });
  it("chat bisnis nyata ke 0822 (27 Sep) TIDAK lolos", () => {
    expect(menyebutSewaVilla("HT 35 Y, 35 kva yanmar engine")).toBe(false);
    expect(menyebutSewaVilla("Nanti kabarin aja yah pak")).toBe(false);
    expect(menyebutSewaVilla("Semalam saya sudah transfer ke kontraktor")).toBe(false);
  });
  it("sapaan kosong seperti 'Halo' tidak cukup", () => {
    expect(menyebutSewaVilla("Halooo")).toBe(false);
  });
});

describe("pilihBookingTerbaik", () => {
  it("check-in aktif menang atas segalanya -> Menginap", () => {
    const r = pilihBookingTerbaik([
      { id: "b1", status: "checkout" },
      { id: "b2", status: "checkin" },
      { id: "b3", status: "terjadwal" },
    ]);
    expect(r).toEqual({ bookingId: "b2", statusTamu: "menginap" });
  });

  it("tanpa check-in aktif, booking terjadwal jadi acuan -> Prospek", () => {
    const r = pilihBookingTerbaik([
      { id: "b1", status: "checkout" },
      { id: "b3", status: "terjadwal" },
    ]);
    expect(r).toEqual({ bookingId: "b3", statusTamu: "prospek" });
  });

  it("hanya ada riwayat checkout -> Selesai", () => {
    const r = pilihBookingTerbaik([{ id: "b1", status: "checkout" }]);
    expect(r).toEqual({ bookingId: "b1", statusTamu: "selesai" });
  });

  it("tidak ada booking sama sekali -> Prospek tanpa booking", () => {
    expect(pilihBookingTerbaik([])).toEqual({ bookingId: null, statusTamu: "prospek" });
  });

  it("mengambil yang PALING DEPAN di antara status yang sama (pemanggil sudah mengurutkan created_at menurun)", () => {
    const r = pilihBookingTerbaik([
      { id: "checkin-terbaru", status: "checkin" },
      { id: "checkin-lama", status: "checkin" },
    ]);
    expect(r.bookingId).toBe("checkin-terbaru");
  });

  it("status lain (mis. batal, menunggu_pembayaran) tidak pernah dipilih", () => {
    const r = pilihBookingTerbaik([
      { id: "b1", status: "batal" },
      { id: "b2", status: "menunggu_pembayaran" },
    ]);
    expect(r).toEqual({ bookingId: null, statusTamu: "prospek" });
  });
});
