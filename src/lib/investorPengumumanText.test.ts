import { describe, expect, it } from "vitest";
import { PENGUMUMAN, penerimaPengumuman } from "./investorPengumumanText";

describe("pengumuman investor 2026-11-08", () => {
  it("menyapa nama dan memuat poin yang disetujui owner", () => {
    const t = PENGUMUMAN.teks("Budi Santoso");
    expect(t).toContain("Yth. Bapak/Ibu *Budi Santoso*,");
    expect(t).toContain("12 November 2026");
    expect(t).toContain("grand opening Loonars Private Living belum terealisasi");
    expect(t).toContain("awal Desember 2026");
    expect(t).toContain("diskon 20% untuk semua produk Loonars");
    expect(t).toContain("https://living.haluoleo.id");
    expect(t).toContain("Loonars tidak akan ada tanpa Bapak/Ibu.");
  });

  it("satu penerima per nomor, nama akun pertama, nomor kosong dihitung", () => {
    const r = penerimaPengumuman([
      { nama: "Ani", hp: "0812-3456-7890" },
      { nama: "Ani (unit 2)", hp: "081234567890" },
      { nama: "Tanpa HP", hp: null },
      { nama: "  ", hp: "085600001111" },
    ]);
    expect(r.penerima).toEqual([
      { hp: "081234567890", nama: "Ani" },
      { hp: "085600001111", nama: "Investor Loonars" },
    ]);
    expect(r.tanpaNomor).toBe(1);
  });
});
