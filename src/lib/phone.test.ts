import { describe, expect, it } from "vitest";
import { nationalSignificantNumber, nomorKanonik, samePhoneNumber } from "./phone";

describe("nomorKanonik", () => {
  it("awalan 0 dari WhaCenter jadi 62 (kasus nyata payload 27 Sep)", () => {
    expect(nomorKanonik("0811400441")).toBe("62811400441");
  });
  it("nomor yang sudah 62 dibiarkan", () => {
    expect(nomorKanonik("6282228885223")).toBe("6282228885223");
  });
  it("membersihkan karakter non-digit", () => {
    expect(nomorKanonik("+62 822-2888-5223")).toBe("6282228885223");
  });
  it("nomor luar negeri tanpa awalan 0 tidak diberi 62", () => {
    expect(nomorKanonik("14155550123")).toBe("14155550123");
  });
});

describe("nationalSignificantNumber", () => {
  it("membuang awalan 62", () => {
    expect(nationalSignificantNumber("6282225908417")).toBe("82225908417");
  });
  it("membuang awalan 0", () => {
    expect(nationalSignificantNumber("081283012301823")).toBe("81283012301823");
  });
  it("membiarkan nomor tanpa awalan", () => {
    expect(nationalSignificantNumber("82225908417")).toBe("82225908417");
  });
  it("membersihkan karakter non-digit dulu (spasi, strip, +)", () => {
    expect(nationalSignificantNumber("+62 822-2590-8417")).toBe("82225908417");
  });
});

describe("samePhoneNumber", () => {
  // Kasus nyata dari database: guests.hp "6282225908417" harus cocok dengan
  // pengirim WhaCenter yang mungkin memakai awalan "0" atau tanpa awalan.
  it("62... cocok dengan 0... untuk nomor yang sama", () => {
    expect(samePhoneNumber("6282225908417", "082225908417")).toBe(true);
  });
  it("62... cocok dengan tanpa awalan", () => {
    expect(samePhoneNumber("6282225908417", "82225908417")).toBe(true);
  });
  it("nomor yang benar-benar beda tidak cocok", () => {
    expect(samePhoneNumber("6282225908417", "6281111111111")).toBe(false);
  });
  it("string kosong tidak pernah cocok dengan apa pun, termasuk sesama kosong", () => {
    expect(samePhoneNumber("", "")).toBe(false);
    expect(samePhoneNumber(null, "6282225908417")).toBe(false);
    expect(samePhoneNumber("6282225908417", undefined)).toBe(false);
  });
  it("nomor terlalu pendek (data rusak) tidak dianggap cocok", () => {
    expect(samePhoneNumber("0", "0")).toBe(false);
    expect(samePhoneNumber("621", "0001")).toBe(false);
  });
});
