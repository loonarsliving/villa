import { describe, expect, it } from "vitest";
import { pilihBookingTerbaik } from "./waChat";

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
