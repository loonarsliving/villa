import { describe, expect, it } from "vitest";

import { bacaPilihanMenu, hanyaSapaan, isiPilihanMenginap, teksMenuSapaan } from "./menuSapaan";

describe("hanyaSapaan", () => {
  it("salam pembuka nyata dari tamu (23 Okt - 5 Nov) dikenali", () => {
    for (const t of ["Halo kak", "Malam kak", "Hallo kak", "halooo pagi kak", "Halo selamat siang ka", "permisi kak", "Selamat siang", "Malam kakk", "hallo ka", "Kak", "Halo", "Assalamualaikum kak 🙏", "Hi min"]) {
      expect(hanyaSapaan(t), t).toBe(true);
    }
  });
  it("pesan yang berisi pertanyaan atau rekan bisnis bukan salam saja", () => {
    for (const t of ["halo malam kak, apakah bisa ?", "Harga brp kk?", "Selamat siang pak", "Pagi bu", "Halo kak, info pl", "Baik kak", "Terima kasih 👍", "", "[non-text message]"]) {
      expect(hanyaSapaan(t), t).toBe(false);
    }
  });
});

describe("bacaPilihanMenu", () => {
  it("membaca jawaban angka yang wajar", () => {
    expect(bacaPilihanMenu("1")).toBe("menginap");
    expect(bacaPilihanMenu(" 1. ")).toBe("menginap");
    expect(bacaPilihanMenu("1 kak")).toBe("menginap");
    expect(bacaPilihanMenu("no 1")).toBe("menginap");
    expect(bacaPilihanMenu("satu")).toBe("menginap");
    expect(bacaPilihanMenu("2")).toBe("properti");
    expect(bacaPilihanMenu("3")).toBe("lainnya");
  });
  it("bukan jawaban menu", () => {
    expect(bacaPilihanMenu("4")).toBeNull();
    expect(bacaPilihanMenu("10")).toBeNull();
    expect(bacaPilihanMenu("1792141088 ini ka")).toBeNull();
    expect(bacaPilihanMenu("1 kamar untuk 2 orang")).toBeNull();
  });
});

describe("teks menu", () => {
  it("menyapa dengan nama dan tidak menjanjikan sarapan gratis", () => {
    const t = teksMenuSapaan("Rina");
    expect(t.startsWith("Halo Kak Rina,")).toBe(true);
    expect(t).toContain("1. Menginap / booking");
    expect(t.toLowerCase()).not.toContain("sarapan");
    expect(teksMenuSapaan(null).startsWith("Halo Kak,")).toBe(true);
  });
  it("isi yang dicatat untuk resepsionis menjelaskan arti angka", () => {
    expect(isiPilihanMenginap("1")).toBe("1 (pilihan menu sapaan: Menginap / booking)");
  });
});
