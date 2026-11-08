import { describe, expect, it } from "vitest";

import { bacaPilihanMenu, hanyaSapaan, isiPilihanMenginap, isiPilihanMenginapEl, JAWABAN_KEBEBASAN, pertanyaanKebebasan, teksMenuSapaan, teksPengingatMenu } from "./menuSapaan";

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
    expect(bacaPilihanMenu("2")).toBe("menginap_el");
    expect(bacaPilihanMenu("dua")).toBe("menginap_el");
    expect(bacaPilihanMenu("3")).toBe("properti");
    expect(bacaPilihanMenu("4")).toBe("lainnya");
  });
  it("bukan jawaban menu", () => {
    expect(bacaPilihanMenu("5")).toBeNull();
    expect(bacaPilihanMenu("10")).toBeNull();
    expect(bacaPilihanMenu("1792141088 ini ka")).toBeNull();
    expect(bacaPilihanMenu("1 kamar untuk 2 orang")).toBeNull();
  });
});

describe("teks menu", () => {
  it("menyapa dengan nama dan tidak menjanjikan sarapan gratis", () => {
    const t = teksMenuSapaan("Rina");
    expect(t.startsWith("Halo Kak Rina,")).toBe(true);
    expect(t).toContain("1. Menginap / booking di Loonars Private Living");
    expect(t).toContain("2. Menginap / booking di Loonars Excellent Living");
    expect(t.toLowerCase()).not.toContain("sarapan");
    expect(teksMenuSapaan(null).startsWith("Halo Kak,")).toBe(true);
  });
  it("menu wajib: tidak menawarkan pertanyaan bebas, dan pengingat memuat pilihan yang sama", () => {
    for (const t of [teksMenuSapaan("Rina"), teksMenuSapaan("Rina", true), teksPengingatMenu()]) {
      expect(t.toLowerCase()).not.toContain("tuliskan pertanyaan");
      expect(t).toContain("4. Lainnya");
      expect(t.toLowerCase()).not.toContain("sarapan");
    }
    expect(teksMenuSapaan("Rina", true)).toContain("pertanyaan Kakak sudah kami terima");
    expect(teksPengingatMenu()).toContain("balas dengan angka saja");
  });
  it("isi yang dicatat untuk resepsionis menjelaskan arti angka", () => {
    expect(isiPilihanMenginap("1")).toBe("1 (pilihan menu sapaan: Menginap / booking)");
  });
  it("pilihan EL tercatat sebagai Excellent Living", async () => {
    const { tentukanPropertiPercakapan, teksSapaanPertama } = await import("./waChat");
    const isi = isiPilihanMenginapEl("2");
    expect(tentukanPropertiPercakapan({ teks: isi, elAktif: false, plAktif: false, sebelumnya: null })).toBe("EL");
    expect(teksSapaanPertama("Rina", isi)).toContain("Loonars Excellent Living");
  });
});

describe("pertanyaanKebebasan", () => {
  it("pertanyaan bebas / syariah / konvensional dikenali", () => {
    for (const t of [
      "untuk vila loonars itu termasuk bebas atau tidak ya",
      "Villa nya syariah atau konvensional?",
      "ini hotel syariah ga",
      "Konvensional kak?",
      "bebas atau tidak kak",
      "loonars bebas ga?",
      "apakah ini penginapan non-syariah",
    ]) {
      expect(pertanyaanKebebasan(t), t).toBe(true);
    }
  });
  it("kata 'bebas' biasa dan pertanyaan lain bukan", () => {
    for (const t of ["bebas biaya parkir?", "bebas sarapan ga?", "wifi bebas?", "Halo kak", "harga kamar berapa", "bisa check in bebas jam berapa saja?"]) {
      expect(pertanyaanKebebasan(t), t).toBe(false);
    }
  });
  it("jawaban tetap persis kalimat owner dan tidak menjanjikan sarapan", () => {
    expect(JAWABAN_KEBEBASAN.startsWith("Halo Kak, Loonars merupakan akomodasi private villa yang terbuka untuk tamu individu, pasangan, maupun keluarga.")).toBe(true);
    expect(JAWABAN_KEBEBASAN).toContain("selama mengikuti house rules yang telah ditetapkan, kami dengan senang hati menyambut kedatangan Kakak. 😊");
    expect(JAWABAN_KEBEBASAN.toLowerCase()).not.toContain("sarapan");
  });
});
