import { describe, expect, it, vi, afterEach } from "vitest";
import { periksaTokenStaf, isStaffToken } from "./villaApiAuth";

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}
afterEach(() => vi.unstubAllGlobals());

const res = (status: number) => new Response(null, { status });

describe("periksaTokenStaf", () => {
  it("token staf yang sah -> lolos", async () => {
    mockFetch(() => res(200));
    expect(await periksaTokenStaf("t")).toBe("lolos");
  });

  it("401/403 dari villa-api -> ditolak", async () => {
    mockFetch(() => res(401));
    expect(await periksaTokenStaf("t")).toBe("ditolak");
    mockFetch(() => res(403));
    expect(await periksaTokenStaf("t")).toBe("ditolak");
  });

  // Inti perubahannya. Klien memanggil endSession() pada 401, jadi gangguan
  // sesaat yang dipetakan jadi "ditolak" akan melempar resepsionis ke
  // halaman login di tengah check-in.
  it("jaringan putus -> gagal-periksa, BUKAN ditolak", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await periksaTokenStaf("t")).toBe("gagal-periksa");
  });

  it("villa-api balas 5xx -> gagal-periksa, BUKAN ditolak", async () => {
    mockFetch(() => res(500));
    expect(await periksaTokenStaf("t")).toBe("gagal-periksa");
    mockFetch(() => res(502));
    expect(await periksaTokenStaf("t")).toBe("gagal-periksa");
    mockFetch(() => res(504));
    expect(await periksaTokenStaf("t")).toBe("gagal-periksa");
  });

  it("kehabisan waktu -> gagal-periksa", async () => {
    mockFetch(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    expect(await periksaTokenStaf("t")).toBe("gagal-periksa");
  });
});

describe("isStaffToken (bentuk lama, dipakai rute admin)", () => {
  it("tetap melempar saat gagal diperiksa, supaya tidak jadi 401", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    await expect(isStaffToken("t")).rejects.toThrow(/tidak bisa dihubungi/);
  });

  it("false hanya untuk penolakan yang sungguhan", async () => {
    mockFetch(() => res(401));
    expect(await isStaffToken("t")).toBe(false);
  });
});
