import { describe, expect, it } from "vitest";

import { bacaBlokirKamar, pilihUnitSementara, type KandidatUnit } from "./cloudbedsUnitSementara";

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
