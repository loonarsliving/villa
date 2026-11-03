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
