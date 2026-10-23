import { describe, expect, it } from "vitest";
import { tujuanChat } from "./chatRoute";

describe("tujuanChat", () => {
  it("mengarahkan tiap peran ke halaman Chat-nya", () => {
    expect(tujuanChat("manager")).toBe("/manager/chat");
    expect(tujuanChat("receptionist")).toBe("/front-desk/chat");
    expect(tujuanChat("admin")).toBe("/front-desk/chat");
  });

  it("peran tanpa menu Chat tidak diarahkan ke chat", () => {
    expect(tujuanChat("owner")).toBeNull();
    expect(tujuanChat("finance")).toBeNull();
    expect(tujuanChat(undefined)).toBeNull();
  });
});
