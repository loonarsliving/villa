import { describe, expect, it } from "vitest";
import { bertumpuk, elDibuatDiSini, jumlahMalam, pecahNama, pilihKamarEl, statusElDariCloudbeds, sumberEl } from "./elCloudbedsLogic";

const dasar = { checkIn: "2026-11-10", checkOut: "2026-11-12", reservationId: "R1", kamarSebelumnya: null };

describe("pilihKamarEl", () => {
  it("memakai kamar yang Cloudbeds tetapkan bila kosong", () => {
    expect(pilihKamarEl({ ...dasar, kamarCloudbeds: "A", kandidatSetipe: ["A", "B"], terpakai: [] })).toEqual({ roomId: "A", pindah: false });
  });
  it("kamar Cloudbeds bentrok dengan booking lokal -> kamar lain setipe, ditandai pindah", () => {
    const terpakai = [{ roomId: "A", checkIn: "2026-11-11", checkOut: "2026-11-13", reservationId: null }];
    expect(pilihKamarEl({ ...dasar, kamarCloudbeds: "A", kandidatSetipe: ["A", "B"], terpakai })).toEqual({ roomId: "B", pindah: true });
  });
  it("pemakaian milik reservasi sendiri tidak dihitung bentrok", () => {
    const terpakai = [{ roomId: "A", checkIn: "2026-11-10", checkOut: "2026-11-12", reservationId: "R1" }];
    expect(pilihKamarEl({ ...dasar, kamarCloudbeds: "A", kandidatSetipe: ["A"], terpakai })?.roomId).toBe("A");
  });
  it("tanpa nomor kamar: kamar sebelumnya didahulukan supaya tidak berpindah tiap sync", () => {
    expect(pilihKamarEl({ ...dasar, kamarCloudbeds: null, kamarSebelumnya: "C", kandidatSetipe: ["A", "B", "C"], terpakai: [] })).toEqual({ roomId: "C", pindah: false });
  });
  it("semua kamar setipe terisi -> null (overbooking)", () => {
    const terpakai = ["A", "B"].map((roomId) => ({ roomId, checkIn: "2026-11-09", checkOut: "2026-11-11", reservationId: null }));
    expect(pilihKamarEl({ ...dasar, kamarCloudbeds: null, kandidatSetipe: ["A", "B"], terpakai })).toBeNull();
  });
  it("checkout hari yang sama dengan check-in berikutnya tidak bentrok", () => {
    expect(bertumpuk("2026-11-10", "2026-11-12", "2026-11-12", "2026-11-14")).toBe(false);
    const terpakai = [{ roomId: "A", checkIn: "2026-11-08", checkOut: "2026-11-10", reservationId: null }];
    expect(pilihKamarEl({ ...dasar, kamarCloudbeds: "A", kandidatSetipe: ["A"], terpakai })?.roomId).toBe("A");
  });
});

describe("pembantu sinkron EL", () => {
  it("status Cloudbeds", () => {
    expect(statusElDariCloudbeds("checked_in")).toBe("checkin");
    expect(statusElDariCloudbeds("confirmed")).toBe("terjadwal");
  });
  it("sumber di luar daftar el_bookings jadi 'cloudbeds'", () => {
    expect(sumberEl("agoda")).toBe("agoda");
    expect(sumberEl("late-night")).toBe("cloudbeds");
  });
  it("booking milik sendiri = bukan dibuat_oleh cloudbeds", () => {
    expect(elDibuatDiSini("cloudbeds")).toBe(false);
    expect(elDibuatDiSini("resepsionis1")).toBe(true);
    expect(elDibuatDiSini(null)).toBe(true);
  });
  it("pecahNama + jumlahMalam", () => {
    expect(pecahNama("Budi")).toEqual({ first: "Budi", last: "Budi" });
    expect(pecahNama("Budi Santoso Putra")).toEqual({ first: "Budi", last: "Santoso Putra" });
    expect(pecahNama("")).toEqual({ first: "Tamu", last: "Excellent Living" });
    expect(jumlahMalam("2026-11-10", "2026-11-13")).toBe(3);
  });
});
