import { describe, expect, it } from "vitest";
import { MAKS_BYTE_GAMBAR_CHAT, bacaGambarDataUrl, bagianGambarChatSah, tautanGambarChat } from "./chatGambarFormat";

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

describe("tautan gambar chat", () => {
  const id = "c7874473-7fba-45fd-90aa-b5e5e737255d";
  const file = "05ebd225-167d-42d9-8a6b-3f1e2d4c5b6a.jpg";

  it("membuat tautan pendek tanpa query di domain villa", () => {
    const url = tautanGambarChat(id, file);
    expect(url).toBe(`https://living.haluoleo.id/api/chat/gambar/${id}/${file}`);
    expect(url).not.toContain("?");
  });

  it("hanya menerima id UUID + nama file UUID bergambar", () => {
    expect(bagianGambarChatSah(id, file)).toBe(true);
    expect(bagianGambarChatSah(id, "foto.jpg")).toBe(false);
    expect(bagianGambarChatSah(id, `${file}.pdf`)).toBe(false);
    expect(bagianGambarChatSah("..", file)).toBe(false);
    expect(bagianGambarChatSah(id, "../ktp/x.jpg")).toBe(false);
  });
});
