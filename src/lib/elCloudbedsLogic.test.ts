import { describe, expect, it } from "vitest";
import { bertumpuk, elDibuatDiSini, jumlahMalam, kamarUntukNamaBerurut, pecahNama, pilihKamarEl, statusElDariCloudbeds, sumberEl } from "./elCloudbedsLogic";

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

import { rencanakanKamarEl, PENANDA_BLOK, buatKodeTipe } from "./elCloudbedsLogic";

const tipe = [{ id: "t-st", kode: "ST", nama: "Standard Twin", active: true }];
const kamarLokal = (o: Partial<{ id: string; nomor: string; room_type_id: string; status: string; active: boolean; catatan: string | null }>) =>
  ({ id: "k", nomor: "X", room_type_id: "t-st", status: "available", active: true, catatan: null, ...o });

describe("rencanakanKamarEl (kamar dari Cloudbeds)", () => {
  const cb = [
    { roomID: "c1", roomName: "101", roomTypeID: "T1", roomTypeName: "Standard Twin" },
    { roomID: "c2", roomName: "201", roomTypeID: "T2", roomTypeName: "Sanctuary Pool", roomTypeNameShort: "SP" },
  ];
  it("kamar baru dibuat, tipe dicocokkan lewat nama, tipe baru dibuat; kamar buatan sistem tidak dinonaktifkan", () => {
    const r = rencanakanKamarEl(cb, tipe, [kamarLokal({ id: "p1", nomor: "ST-01" })], []);
    expect(r.tipeCocok.get("T1")).toBe("t-st");
    expect(r.tipeBaru).toEqual([{ kunci: "T2", kode: "SP", nama: "Sanctuary Pool", sort_order: 2 }]);
    expect(r.kamarBaru.map((k) => k.nomor)).toEqual(["101", "201"]);
    expect(r.nonaktifkan).toEqual([]);
  });
  it("kamar berpeta yang room Cloudbeds-nya hilang dinonaktifkan", () => {
    const r = rencanakanKamarEl(cb.slice(0, 1), tipe, [kamarLokal({ id: "a", nomor: "101" }), kamarLokal({ id: "b", nomor: "ST-05" })], [
      { cloudbeds_room_id: "c1", room_id: "a" },
      { cloudbeds_room_id: "c-hilang", room_id: "b" },
    ]);
    expect(r.nonaktifkan).toEqual(["b"]);
  });
  it("kamar lama dengan nomor sama dipetakan, bukan dibuat ulang", () => {
    const r = rencanakanKamarEl(cb.slice(0, 1), tipe, [kamarLokal({ id: "a", nomor: "101" })], []);
    expect(r.petaBaru).toEqual([{ cloudbeds_room_id: "c1", cloudbeds_room_name: "101", room_id: "a" }]);
    expect(r.kamarBaru).toEqual([]);
    expect(r.nonaktifkan).toEqual([]);
  });
  it("kamar dipetakan yang nonaktif diaktifkan lagi; nama tetap nama di sistem", () => {
    const r = rencanakanKamarEl(cb.slice(0, 1), tipe, [kamarLokal({ id: "a", nomor: "ST-01", active: false })], [{ cloudbeds_room_id: "c1", room_id: "a" }]);
    expect(r.ubahKamar).toEqual([{ id: "a", isi: { active: true } }]);
  });
  it("blokir Cloudbeds -> maintenance bertanda, dibuka lagi -> available; maintenance manual tidak disentuh", () => {
    const peta = [{ cloudbeds_room_id: "c1", room_id: "a" }];
    const tutup = rencanakanKamarEl([{ ...cb[0], roomBlocked: true }], tipe, [kamarLokal({ id: "a", nomor: "101" })], peta);
    expect(tutup.ubahKamar[0].isi).toEqual({ status: "maintenance", catatan: PENANDA_BLOK });
    const buka = rencanakanKamarEl(cb.slice(0, 1), tipe, [kamarLokal({ id: "a", nomor: "101", status: "maintenance", catatan: `${PENANDA_BLOK} AC` })], peta);
    expect(buka.ubahKamar[0].isi).toEqual({ status: "available", catatan: "AC" });
    const manual = rencanakanKamarEl(cb.slice(0, 1), tipe, [kamarLokal({ id: "a", nomor: "101", status: "maintenance", catatan: "bocor" })], peta);
    expect(manual.ubahKamar).toEqual([]);
  });
  it("room virtual diabaikan", () => {
    const r = rencanakanKamarEl([{ ...cb[0], isVirtual: true }], tipe, [], []);
    expect(r.kamarBaru).toEqual([]);
  });
  it("kode tipe unik", () => {
    const dipakai = new Set(["ST"]);
    expect(buatKodeTipe("Standard Twin", undefined, dipakai)).toBe("ST2");
    expect(buatKodeTipe("Family Private Pool", undefined, dipakai)).toBe("FPP");
  });
});

describe("kamarUntukNamaBerurut", () => {
  const tipe = [{ id: "d", code: "DOU" }, { id: "q", code: "QUA" }];
  const kamar = [
    { id: 1, nomor: "ST-10", room_type_id: "d" },
    { id: 2, nomor: "ST-02", room_type_id: "d" },
    { id: 3, nomor: "ST-01", room_type_id: "d" },
    { id: 4, nomor: "ST-14", room_type_id: "q" },
    { id: 5, nomor: "ST-13", room_type_id: "q" },
  ];
  it("memetakan KODE(n) ke kamar ke-n tipe itu (urut nomor)", () => {
    expect(kamarUntukNamaBerurut("DOU(2)", "DOU", tipe, kamar)?.nomor).toBe("ST-02");
    expect(kamarUntukNamaBerurut("DOU(3)", undefined, tipe, kamar)?.nomor).toBe("ST-10");
    expect(kamarUntukNamaBerurut("QUA(2)", "QUA", tipe, kamar)?.nomor).toBe("ST-14");
  });
  it("tidak memetakan nomor di luar jumlah kamar, kode lain, atau nama bebas", () => {
    expect(kamarUntukNamaBerurut("QUA(3)", "QUA", tipe, kamar)).toBeNull();
    expect(kamarUntukNamaBerurut("DOU(2)", "QUA", tipe, kamar)).toBeNull();
    expect(kamarUntukNamaBerurut("KIN(1)", "KIN", tipe, kamar)).toBeNull();
    expect(kamarUntukNamaBerurut("ST-02", "DOU", tipe, kamar)).toBeNull();
  });
});
