import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { klienProperti } from "./klienProperti";

/** Klien palsu yang mencatat setiap panggilan builder. */
function palsu() {
  const log: unknown[][] = [];
  const builder = (tabel: string) => {
    const b: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["select", "update", "delete", "insert", "upsert", "eq", "order", "single"]) {
      b[m] = (...a: unknown[]) => {
        log.push([tabel, m, ...a]);
        return b;
      };
    }
    return b;
  };
  const klien = { from: (t: string) => builder(t), rpc: (n: string) => log.push(["rpc", n]), storage: { ada: true } };
  return { klien: klien as unknown as SupabaseClient, log };
}

describe("klienProperti (pengaman multi-properti)", () => {
  it("select/update/delete tabel inti otomatis disaring ke PL", () => {
    const { klien, log } = palsu();
    const s = klienProperti(klien);
    s.from("bookings").select("*").order("tgl_checkin");
    s.from("units").select("id", { count: "exact", head: true });
    s.from("bookings").update({ status: "batal" }).eq("id", "x");
    s.from("transactions").delete().eq("id", "y");
    expect(log).toEqual([
      ["bookings", "select", "*"], ["bookings", "eq", "property_kode", "PL"], ["bookings", "order", "tgl_checkin"],
      ["units", "select", "id", { count: "exact", head: true }], ["units", "eq", "property_kode", "PL"],
      ["bookings", "update", { status: "batal" }], ["bookings", "eq", "property_kode", "PL"], ["bookings", "eq", "id", "x"],
      ["transactions", "delete"], ["transactions", "eq", "property_kode", "PL"], ["transactions", "eq", "id", "y"],
    ]);
  });
  it("insert/upsert mengisi property_kode, kecuali sudah diisi", () => {
    const { klien, log } = palsu();
    const s = klienProperti(klien);
    s.from("bookings").insert({ guest_nama: "A" });
    s.from("finance_settlements").upsert([{ booking_id: "1" }, { booking_id: "2", property_kode: "EL" }], { onConflict: "booking_id" });
    expect(log).toEqual([
      ["bookings", "insert", { guest_nama: "A", property_kode: "PL" }],
      ["finance_settlements", "upsert", [{ booking_id: "1", property_kode: "PL" }, { booking_id: "2", property_kode: "EL" }], { onConflict: "booking_id" }],
    ]);
  });
  it("tabel lain, rpc, dan storage tidak disentuh", () => {
    const { klien, log } = palsu();
    const s = klienProperti(klien);
    s.from("guests").select("*");
    s.rpc("villa_commit_checkin");
    expect(log).toEqual([["guests", "select", "*"], ["rpc", "villa_commit_checkin"]]);
    expect((s as unknown as { storage: { ada: boolean } }).storage.ada).toBe(true);
  });
  it("klien properti EL hanya melihat EL", () => {
    const { klien, log } = palsu();
    klienProperti(klien, "EL").from("bookings").select("id");
    expect(log).toEqual([["bookings", "select", "id"], ["bookings", "eq", "property_kode", "EL"]]);
  });
});
