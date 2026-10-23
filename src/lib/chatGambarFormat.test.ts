import { describe, expect, it } from "vitest";
import { MAKS_BYTE_GAMBAR_CHAT, bacaGambarDataUrl } from "./chatGambarFormat";

const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");

describe("bacaGambarDataUrl", () => {
  it("menerima JPEG/PNG/WebP", () => {
    const jpg = bacaGambarDataUrl(`data:image/jpeg;base64,${b64(10)}`);
    expect(jpg).toMatchObject({ ext: "jpg", contentType: "image/jpeg" });
    expect(bacaGambarDataUrl(`data:image/png;base64,${b64(10)}`)).toMatchObject({ ext: "png" });
    expect(bacaGambarDataUrl(`data:image/webp;base64,${b64(10)}`)).toMatchObject({ ext: "webp" });
  });

  it("menolak format lain, data rusak, dan gambar kosong", () => {
    expect(bacaGambarDataUrl(`data:image/svg+xml;base64,${b64(10)}`)).toHaveProperty("error");
    expect(bacaGambarDataUrl(`data:application/pdf;base64,${b64(10)}`)).toHaveProperty("error");
    expect(bacaGambarDataUrl("bukan data url")).toHaveProperty("error");
    expect(bacaGambarDataUrl("data:image/jpeg;base64,")).toHaveProperty("error");
  });

  it("menolak gambar di atas batas", () => {
    expect(bacaGambarDataUrl(`data:image/jpeg;base64,${b64(MAKS_BYTE_GAMBAR_CHAT + 1)}`)).toHaveProperty("error");
  });
});
