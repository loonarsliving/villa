import { describe, expect, it } from "vitest";

import { parseRoomsAvailableByRoomType } from "./cloudbedsApi";

describe("parseRoomsAvailableByRoomType", () => {
  it("reads rooms left per room type per date, as Cloudbeds sends it (numbers as strings)", () => {
    const m = parseRoomsAvailableByRoomType([
      { roomTypeID: "270500726767808", roomRateDetailed: [{ date: "2026-10-05", roomsAvailable: "1" }, { date: "2026-10-06", roomsAvailable: 3 }] },
      { roomTypeID: "269425676509312", roomRateDetailed: [{ date: "2026-10-05", roomsAvailable: 3 }] },
    ]);
    expect(m.get("270500726767808")?.get("2026-10-05")).toBe(1);
    expect(m.get("270500726767808")?.get("2026-10-06")).toBe(3);
    expect(m.get("269425676509312")?.get("2026-10-05")).toBe(3);
  });
  it("takes the largest figure when a room type has several rate plans, and skips junk", () => {
    const m = parseRoomsAvailableByRoomType([
      { roomTypeID: "a", roomRateDetailed: [{ date: "2026-10-05", roomsAvailable: 2 }] },
      { roomTypeID: "a", roomRateDetailed: [{ date: "2026-10-05", roomsAvailable: 4 }, { date: "", roomsAvailable: 1 }, { date: "2026-10-06", roomsAvailable: "x" }] },
      { roomRateDetailed: [] },
    ]);
    expect(m.get("a")?.get("2026-10-05")).toBe(4);
    expect(m.get("a")?.has("2026-10-06")).toBe(false);
  });
});
