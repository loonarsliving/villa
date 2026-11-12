import { describe, expect, it } from "vitest";
import { baruDiPerangkat, tandaiDilihat, totalBaruDiPerangkat } from "./chatPerangkat";

const c = (id: string, unread: number, at: string) => ({ id, unread_count: unread, last_message_at: at });

describe("chatPerangkat", () => {
  it("chat belum dibalas tampil baru di perangkat yang belum membukanya", () => {
    expect(baruDiPerangkat(c("a", 2, "2026-11-12T10:00:00+00:00"), {})).toBe(true);
  });

  it("sudah dibuka di perangkat ini -> tidak baru sampai ada pesan lebih baru", () => {
    const d = tandaiDilihat({}, "a", "2026-11-12T10:00:00.123456+00:00");
    expect(baruDiPerangkat(c("a", 2, "2026-11-12T10:00:00.123456+00:00"), d)).toBe(false);
    expect(baruDiPerangkat(c("a", 3, "2026-11-12T10:05:00+00:00"), d)).toBe(true);
  });

  it("sudah dibalas (unread 0) tidak pernah baru", () => {
    expect(baruDiPerangkat(c("a", 0, "2026-11-12T10:00:00+00:00"), {})).toBe(false);
  });

  it("total lencana hanya menghitung yang baru di perangkat ini", () => {
    const d = { a: "2026-11-12T10:00:00+00:00" };
    expect(totalBaruDiPerangkat([c("a", 2, "2026-11-12T10:00:00+00:00"), c("b", 3, "2026-11-12T09:00:00+00:00")], d)).toBe(3);
  });

  it("tidak mundur ke waktu lama dan dibatasi jumlahnya", () => {
    const d = { a: "2026-11-12T10:00:00+00:00" };
    expect(tandaiDilihat(d, "a", "2026-11-12T09:00:00+00:00")).toBe(d);
    let besar = {};
    for (let i = 0; i < 450; i++) besar = tandaiDilihat(besar, `k${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
    expect(Object.keys(besar)).toHaveLength(400);
    expect(besar).toHaveProperty("k449");
    expect(besar).not.toHaveProperty("k0");
  });
});
