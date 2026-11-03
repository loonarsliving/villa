import { describe, expect, it } from "vitest";
import { ENV_EL, envPertama } from "./cloudbedsApi";

describe("envPertama (akun Cloudbeds Excellent Living)", () => {
  it("membaca nama env yang dipasang owner (*_LOONARS2)", () => {
    expect(envPertama(ENV_EL.apiKey, { CLOUDBEDS_API_KEY_LOONARS2: " kunci " })).toBe("kunci");
    expect(envPertama(ENV_EL.webhookSecret, { CLOUDBEDS_SECRET_LOONARS2: "rahasia" })).toBe("rahasia");
  });
  it("CLOUDBEDS2_* menang bila keduanya ada", () => {
    expect(envPertama(ENV_EL.apiKey, { CLOUDBEDS2_API_KEY: "a", CLOUDBEDS_API_KEY_LOONARS2: "b" })).toBe("a");
  });
  it("kosong / spasi saja = belum dikonfigurasi", () => {
    expect(envPertama(ENV_EL.apiKey, { CLOUDBEDS2_API_KEY: "  " })).toBe("");
    expect(envPertama(ENV_EL.propertyId, {})).toBe("");
  });
  it("tidak pernah membaca kunci Private Living", () => {
    expect(envPertama(ENV_EL.apiKey, { CLOUDBEDS_API_KEY: "kunci-private-living" })).toBe("");
  });
});

import { jenisKunci, periksaKunciEl } from "./cloudbedsApi";
import { vi } from "vitest";

describe("periksaKunciEl", () => {
  it("memakai env yang diterima Cloudbeds, tanpa membuka isi kunci", async () => {
    const asli = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      const ok = h["x-api-key"] === "cbat_benar";
      return new Response(JSON.stringify(ok ? { success: true, data: [{ propertyID: "1", propertyName: "EL" }] } : { success: false, message: "denied" }), { status: ok ? 200 : 401 });
    }) as typeof fetch;
    try {
      const r = await periksaKunciEl({ CLOUDBEDS_API_KEY_LOONARS2: "client-id-salah", CLOUDBEDS_SECRET_LOONARS2: "cbat_benar" });
      expect(r.terpilih).toBe("CLOUDBEDS_SECRET_LOONARS2");
      expect(r.hasil[0]).toMatchObject({ env: "CLOUDBEDS_API_KEY_LOONARS2", http_x_api_key: 401, jenis: "lain" });
      expect(r.hasil[1]).toMatchObject({ jenis: "cbat_", properti: [{ id: "1", nama: "EL" }] });
      expect(JSON.stringify(r)).not.toContain("cbat_benar");
      expect(JSON.stringify(r)).not.toContain("client-id-salah");
    } finally {
      globalThis.fetch = asli;
    }
  });
  it("jenisKunci", () => {
    expect(jenisKunci("cbat_x")).toBe("cbat_");
    expect(jenisKunci("live1_x")).toBe("live1_");
    expect(jenisKunci("abc")).toBe("lain");
  });
});

import { getCloudbedsRooms, diagnosaGetRooms } from "./cloudbedsApi";

describe("getCloudbedsRooms membaca semua halaman", () => {
  it("31 room di 2 halaman terbaca semua", async () => {
    const asli = globalThis.fetch;
    const semua = Array.from({ length: 31 }, (_, i) => ({ roomID: `r${i}`, roomName: `K${i}`, roomTypeID: `T${i % 4}`, roomTypeName: `Tipe ${i % 4}` }));
    const urls: string[] = [];
    globalThis.fetch = (async (u: URL) => {
      urls.push(String(u));
      const hal = Number(new URL(String(u)).searchParams.get("pageNumber"));
      // Cloudbeds mungkin mengabaikan pageSize: kirim 20 per halaman.
      const isi = semua.slice((hal - 1) * 20, hal * 20);
      return new Response(JSON.stringify({ success: true, total: 31, data: [{ propertyID: "1", rooms: isi }] }));
    }) as unknown as typeof fetch;
    process.env.CLOUDBEDS2_API_KEY = "cbat_uji";
    try {
      const rooms = await getCloudbedsRooms("el");
      expect(rooms).toHaveLength(31);
      expect(new Set(rooms.map((r) => r.roomTypeID)).size).toBe(4);
      expect(urls).toHaveLength(2);
      expect(diagnosaGetRooms("el")).toEqual({ halaman: 2, total_dari_cloudbeds: 31, room_diterima: 31, room_virtual: 0 });
    } finally {
      globalThis.fetch = asli;
      delete process.env.CLOUDBEDS2_API_KEY;
    }
  });
});
