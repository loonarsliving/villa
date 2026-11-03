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
