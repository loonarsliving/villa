import { describe, expect, it } from "vitest";
import { hitungPerkiraan } from "./AmenitiesRingkasan";
import type { AmenityItem, AmenityKitItem } from "@/lib/types";

const items: AmenityItem[] = [
  { id: "a", nama: "Amenities", satuan: "pcs", stock: 100, stock_minimum: 20, updated_at: "" },
];
const kit: AmenityKitItem[] = [{ id: "k", amenity_id: "a", qty: 1 }];

describe("hitungPerkiraan", () => {
  it("1 per kamar per malam: 13 kamar terisi, 100 stock = cukup 7 malam", () => {
    expect(hitungPerkiraan(items, kit, 13)[0]).toMatchObject({ perMalam: 13, cukupMalam: 7 });
  });
  it("tanpa kamar terisi tidak ada perkiraan", () => {
    expect(hitungPerkiraan(items, kit, 0)[0].cukupMalam).toBeNull();
  });
});
