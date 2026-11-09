import { describe, expect, it } from "vitest";
import { hariTerbuka, rencanaTutupRoomLebih, roomLebih, tambahHari, type RoomCb } from "./cloudbedsRoomLebih";

const QUA = "290613128560768";
const rooms: RoomCb[] = [
  { roomID: `${QUA}-0`, roomName: "QUA(1)", roomTypeID: QUA },
  { roomID: `${QUA}-1`, roomName: "QUA(2)", roomTypeID: QUA },
  { roomID: `${QUA}-2`, roomName: "QUA(3)", roomTypeID: QUA },
  { roomID: `${QUA}-3`, roomName: "QUA(4)", roomTypeID: QUA },
  { roomID: "BARU-0", roomName: "NEW(1)", roomTypeID: "BARU" },
  { roomID: "V-0", roomName: "virtual", roomTypeID: QUA, isVirtual: true },
];
const berpeta = new Set([`${QUA}-0`, `${QUA}-1`]);

describe("roomLebih", () => {
  it("hanya room tanpa peta yang tipenya sudah punya kamar berpeta", () => {
    expect(roomLebih(rooms, berpeta).map((r) => r.roomName)).toEqual(["QUA(3)", "QUA(4)"]);
  });
  it("tipe yang belum dikenal sama sekali tidak disentuh", () => {
    expect(roomLebih(rooms, new Set())).toEqual([]);
  });
});

describe("rencanaTutupRoomLebih", () => {
  const hariIni = "2026-11-09";
  const lebih = roomLebih(rooms, berpeta);

  it("blokir lama s/d 2027-01-01 -> blokir baru mulai 2027-01-01, tidak menumpuk", () => {
    const blok = [{ roomIds: lebih.map((r) => r.roomID), startDate: "2026-11-04", endDate: "2027-01-01" }];
    const r = rencanaTutupRoomLebih(lebih, blok, hariIni);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ roomName: "QUA(3)", startDate: "2027-01-01", endDate: tambahHari(hariIni, 730) });
  });

  it("tanpa blokir -> ditutup mulai hari ini", () => {
    expect(rencanaTutupRoomLebih(lebih, [], hariIni)[0].startDate).toBe(hariIni);
  });

  it("sudah tertutup cukup lama -> tidak ada blokir baru", () => {
    const blok = [{ roomIds: lebih.map((r) => r.roomID), startDate: hariIni, endDate: tambahHari(hariIni, 730) }];
    expect(rencanaTutupRoomLebih(lebih, blok, hariIni)).toEqual([]);
  });

  it("berhenti sebelum blokir berikutnya untuk room itu", () => {
    const blok = [{ roomIds: [lebih[0].roomID], startDate: "2027-03-01", endDate: "2027-03-05" }];
    expect(rencanaTutupRoomLebih([lebih[0]], blok, hariIni)[0]).toMatchObject({ startDate: hariIni, endDate: "2027-03-01" });
  });
});

describe("hariTerbuka", () => {
  it("melompati blokir berurutan", () => {
    const blok = [
      { roomIds: ["a"], startDate: "2026-11-01", endDate: "2026-12-01" },
      { roomIds: ["a"], startDate: "2026-12-01", endDate: "2027-01-01" },
    ];
    expect(hariTerbuka("a", blok, "2026-11-09", "2028-01-01")).toBe("2027-01-01");
    expect(hariTerbuka("a", [{ roomIds: ["a"], startDate: "2026-01-01", endDate: null }], "2026-11-09", "2028-01-01")).toBeNull();
  });
});
