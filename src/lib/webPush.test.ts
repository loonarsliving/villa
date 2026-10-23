import { describe, expect, it } from "vitest";

import { isiNotifChatTamu } from "./webPush";

describe("isiNotifChatTamu", () => {
  it("memakai nama tamu sebagai judul dan isi pesan sebagai badan", () => {
    expect(isiNotifChatTamu({ nama: "Budi", phone: "6281200001111", text: " Masih ada kamar? ", adaMedia: false })).toEqual({
      title: "Pesan dari Budi",
      body: "Masih ada kamar?",
    });
  });

  it("jatuh ke nomor bila nama kosong, dan menandai foto tanpa teks", () => {
    expect(isiNotifChatTamu({ nama: "", phone: "6281200001111", text: "", adaMedia: true })).toEqual({
      title: "Pesan dari 6281200001111",
      body: "📷 Foto / file",
    });
  });

  it("memotong pesan panjang", () => {
    const body = isiNotifChatTamu({ nama: "A", phone: "1", text: "x".repeat(300), adaMedia: false }).body;
    expect(body.length).toBe(180);
    expect(body.endsWith("...")).toBe(true);
  });
});
