import { describe, expect, it } from "vitest";

import { bacaBlokirKamar, pilihUnitSementara, rencanaPindahKamar, type KandidatUnit } from "./cloudbedsUnitSementara";

const RT = "270500726767808";
const unit = (idx: number, nomor: string): KandidatUnit => ({ cloudbedsRoomId: `${RT}-${idx}`, unitId: `u-${nomor}`, unitNomor: nomor });
const KANDIDAT = [unit(0, "A1"), unit(3, "B1"), unit(4, "B2"), unit(8, "C3"), unit(9, "A4"), { cloudbedsRoomId: "999-0", unitId: "u-X", unitNomor: "X" }];

describe("pilihUnitSementara", () => {
  it("kasus Albi 29-31 Okt: melewati unit yang terisi dan yang diblokir, memilih C3", () => {
    const hasil = pilihUnitSementara({
      roomTypeId: RT,
      checkIn: "2026-10-29",
      checkOut: "2026-10-31",
      kandidat: KANDIDAT,
      terpakai: [
        { unitId: "u-A1", checkIn: "2026-10-29", checkOut: "2026-10-30" },
        { unitId: "u-B1", checkIn: "2026-10-29", checkOut: "2026-10-30" },
        { unitId: "u-B2", checkIn: "2026-10-30", checkOut: "2026-11-01" },
      ],
      blokir: [{ roomIds: [`${RT}-9`], startDate: "2026-10-28", endDate: "2026-10-30" }],
    });
    expect(hasil?.unitNomor).toBe("C3");
  });

  it("checkout di hari check-in tamu lain tidak dianggap bentrok", () => {
    const hasil = pilihUnitSementara({
      roomTypeId: RT,
      checkIn: "2026-10-30",
      checkOut: "2026-10-31",
      kandidat: [unit(0, "A1")],
      terpakai: [{ unitId: "u-A1", checkIn: "2026-10-28", checkOut: "2026-10-30" }],
      blokir: [{ roomIds: [`${RT}-0`], startDate: "2026-10-29", endDate: "2026-10-30" }],
    });
    expect(hasil?.unitNomor).toBe("A1");
  });

  it("mempertahankan unit dari sync sebelumnya selama masih kosong", () => {
    const hasil = pilihUnitSementara({
      roomTypeId: RT,
      checkIn: "2026-11-01",
      checkOut: "2026-11-02",
      kandidat: KANDIDAT,
      terpakai: [],
      blokir: [],
      unitSebelumnya: "u-A4",
    });
    expect(hasil?.unitNomor).toBe("A4");
  });

  it("pindah dari unit lama kalau unit itu kini dipakai", () => {
    const hasil = pilihUnitSementara({
      roomTypeId: RT,
      checkIn: "2026-11-01",
      checkOut: "2026-11-02",
      kandidat: KANDIDAT,
      terpakai: [{ unitId: "u-A4", checkIn: "2026-11-01", checkOut: "2026-11-03" }],
      blokir: [],
      unitSebelumnya: "u-A4",
    });
    expect(hasil?.unitNomor).toBe("A1");
  });

  it("booking tanpa tanggal checkout dianggap memakai unit seterusnya", () => {
    const hasil = pilihUnitSementara({
      roomTypeId: RT,
      checkIn: "2026-12-01",
      checkOut: "2026-12-02",
      kandidat: [unit(0, "A1")],
      terpakai: [{ unitId: "u-A1", checkIn: "2026-11-01", checkOut: null }],
      blokir: [],
    });
    expect(hasil).toBeNull();
  });

  it("tidak memilih unit dari tipe kamar lain", () => {
    const hasil = pilihUnitSementara({
      roomTypeId: "999",
      checkIn: "2026-11-01",
      checkOut: "2026-11-02",
      kandidat: KANDIDAT,
      terpakai: [{ unitId: "u-X", checkIn: "2026-11-01", checkOut: "2026-11-02" }],
      blokir: [],
    });
    expect(hasil).toBeNull();
  });
});

describe("bacaBlokirKamar", () => {
  it("membaca bentuk getRoomBlocks (data[].roomBlocks[].rooms[].roomID)", () => {
    const hasil = bacaBlokirKamar([
      { roomBlocks: [{ roomBlockID: "1", startDate: "2026-10-29", endDate: "2026-10-30", rooms: [{ roomID: `${RT}-4` }] }] },
      null,
      { roomBlocks: [{ endDate: "2026-10-30" }] },
    ]);
    expect(hasil).toEqual([{ roomIds: [`${RT}-4`], startDate: "2026-10-29", endDate: "2026-10-30" }]);
  });
});

describe("rencanaPindahKamar", () => {
  const T = "270500726767808";
  const u = (i: number, nomor: string) => ({ cloudbedsRoomId: `${T}-${i}`, unitId: `u-${nomor}`, unitNomor: nomor });
  const A4 = u(9, "A4");
  const C2 = u(7, "C2");
  const A1 = u(0, "A1");
  const kandidat = [A1, C2, A4];

  it("el nasution 10-13 Nov: bukan overbooking, cukup pindah A4 lalu C2", () => {
    const r = rencanaPindahKamar({
      roomTypeId: T,
      checkIn: "2026-11-10",
      checkOut: "2026-11-13",
      kandidat,
      blokir: [],
      terpakai: [
        { unitId: "u-A1", checkIn: "2026-11-10", checkOut: "2026-11-13" },
        { unitId: "u-C2", checkIn: "2026-11-10", checkOut: "2026-11-11" },
        { unitId: "u-A4", checkIn: "2026-11-11", checkOut: "2026-11-14" },
      ],
    });
    expect(r).toEqual({
      bisa: true,
      segmen: [
        { unit: A4, dari: "2026-11-10", sampai: "2026-11-11" },
        { unit: C2, dari: "2026-11-11", sampai: "2026-11-13" },
      ],
    });
  });

  it("menyebut malam yang memang penuh (overbooking sungguhan)", () => {
    const r = rencanaPindahKamar({
      roomTypeId: T,
      checkIn: "2026-12-30",
      checkOut: "2027-01-01",
      kandidat: [A1, A4],
      blokir: [{ roomIds: [`${T}-9`], startDate: "2026-12-31", endDate: "2027-01-01" }],
      terpakai: [{ unitId: "u-A1", checkIn: "2026-12-30", checkOut: "2027-01-01" }],
    });
    expect(r).toEqual({ bisa: false, malamPenuh: ["2026-12-31"] });
  });

  it("tidak merencanakan booking tanpa tanggal keluar", () => {
    expect(rencanaPindahKamar({ roomTypeId: T, checkIn: "2026-11-10", checkOut: null, kandidat, blokir: [], terpakai: [] })).toEqual({ bisa: false, malamPenuh: [] });
  });
});
