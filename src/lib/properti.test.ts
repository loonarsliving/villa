import { describe, expect, it } from "vitest";
import { propertiDariToken } from "./villaApiAuth";
import { berandaProperti } from "./properti";

const token = (isi: object) => `${Buffer.from(JSON.stringify(isi)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.tanda`;

describe("multi-properti: sesi & beranda", () => {
  it("properti dibaca dari token sesi villa-api", () => {
    expect(propertiDariToken(token({ uid: "1", role: "manager", property_kode: "EL" }))).toBe("EL");
    expect(propertiDariToken(token({ uid: "1", role: "admin" }))).toBeNull();
    expect(propertiDariToken(token({ uid: "1", property_kode: null }))).toBeNull();
    expect(propertiDariToken("bukan-token")).toBeNull();
  });
  it("beranda per properti untuk admin & finance", () => {
    expect(berandaProperti("PL", "admin")).toBe("/admin");
    expect(berandaProperti("PL", "finance")).toBe("/finance");
    expect(berandaProperti("EL", "admin")).toBe("/excellent/front-desk");
    expect(berandaProperti("EL", "finance")).toBe("/finance/excellent-living");
    expect(berandaProperti("LB", "admin")).toBeNull();
  });
});
