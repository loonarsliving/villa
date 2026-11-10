import { describe, expect, it } from "vitest";

import { formSelarasKamar, rencanaSelarasKamar } from "./cloudbedsSelarasKamar";

const dasar = { reservationID: "6B5D5AF5AG", targetRoomID: "270500726767808-9", targetRoomTypeID: "270500726767808" };

describe("rencanaSelarasKamar", () => {
  it("menetapkan kamar untuk reservasi yang belum di-assign (push hanya tipe kamar)", () => {
    const r = rencanaSelarasKamar({ ...dasar, rooms: [{ roomID: null, roomTypeID: "270500726767808", subReservationID: "6B5D5AF5AG-1" }] });
    expect(r).toEqual({ reservationID: "6B5D5AF5AG", subReservationID: "6B5D5AF5AG-1", newRoomID: "270500726767808-9", roomTypeID: "270500726767808", oldRoomID: null });
  });

  it("memindahkan dari kamar lain dan mengirim oldRoomID", () => {
    const r = rencanaSelarasKamar({ ...dasar, rooms: [{ roomID: "270500726767808-7", roomTypeID: "270500726767808", subReservationID: "s1" }] });
    expect(r?.oldRoomID).toBe("270500726767808-7");
    expect(r?.newRoomID).toBe("270500726767808-9");
  });

  it("tidak melakukan apa-apa kalau kamarnya sudah sama", () => {
    expect(rencanaSelarasKamar({ ...dasar, rooms: [{ roomID: "270500726767808-9", subReservationID: "s1" }] })).toBeNull();
  });

  it("tidak menebak untuk reservasi multi-kamar, tanpa subReservationID, atau tanpa target", () => {
    expect(rencanaSelarasKamar({ ...dasar, rooms: [{ subReservationID: "a" }, { subReservationID: "b" }] })).toBeNull();
    expect(rencanaSelarasKamar({ ...dasar, rooms: [{ roomID: null }] })).toBeNull();
    expect(rencanaSelarasKamar({ ...dasar, targetRoomID: null, rooms: [{ subReservationID: "a" }] })).toBeNull();
    expect(rencanaSelarasKamar({ ...dasar, rooms: [] })).toBeNull();
  });
});

describe("formSelarasKamar", () => {
  it("tidak pernah mengirim adjustPrice (harga reservasi tetap)", () => {
    const f = formSelarasKamar({ reservationID: "R", subReservationID: "S", newRoomID: "N", roomTypeID: "T", oldRoomID: null }, "P");
    expect(f.get("adjustPrice")).toBeNull();
    expect(f.get("overrideRates")).toBeNull();
    expect(f.get("oldRoomID")).toBeNull();
    expect(f.get("propertyID")).toBe("P");
    expect(f.get("newRoomID")).toBe("N");
  });
});
