import { describe, expect, it } from "vitest";
import { hitungRingkasan, jumlahPerUnit, kelompokkanPenerima, nomorBukti, teksPengantar, type InvestorAkun } from "./buktiTransferData";

function akun(o: Partial<InvestorAkun>): InvestorAkun {
  return {
    id: "u1",
    nama: "Investor",
    hp: "081200000001",
    unit_nomor: "A1",
    bank_nama: "BCA",
    no_rekening: "1234567890",
    nama_pemilik_rekening: null,
    units: ["A1"],
    pemasukan_tetap: null,
    ...o,
  };
}

describe("jumlahPerUnit", () => {
  it("bagi hasil di bawah jaminan ditambah top-up sampai jaminan", () => {
    expect(jumlahPerUnit({ per_investor_amount: 3_265_410.6, jaminan_topup: 1_734_589.4 })).toBe(5_000_000);
  });
  it("bagi hasil di atas jaminan dipakai apa adanya", () => {
    expect(jumlahPerUnit({ per_investor_amount: 6_100_000, jaminan_topup: 0 })).toBe(6_100_000);
  });
});

describe("kelompokkanPenerima", () => {
  it("dua akun dengan nomor sama jadi satu bukti gabungan", () => {
    const p = kelompokkanPenerima(
      [
        akun({ id: "a", nama: "Susanto", hp: "081285710800", unit_nomor: "A5", units: ["A5"] }),
        akun({ id: "b", nama: "Susanto", hp: "0812-8571-0800", unit_nomor: "C3", units: ["C3"] }),
      ],
      5_000_000,
    );
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ units: ["A5", "C3"], jumlah: 10_000_000, rek4: "7890" });
  });

  it("nama pemilik rekening didahulukan, akun tanpa nomor dilewati", () => {
    const p = kelompokkanPenerima(
      [akun({ nama: "Investor A1", nama_pemilik_rekening: "MUSAFA" }), akun({ id: "x", hp: null, unit_nomor: "A4", units: ["A4"] })],
      5_000_000,
    );
    expect(p.map((x) => x.nama)).toEqual(["MUSAFA"]);
  });

  it("pemasukan tetap memakai angkanya sendiri, bukan jaminan", () => {
    const p = kelompokkanPenerima([akun({ hp: "081373347448", unit_nomor: "Pemasukan Tetap", units: [], pemasukan_tetap: 7_600_000 })], 5_000_000);
    expect(p[0]).toMatchObject({ jumlah: 7_600_000, pemasukan_tetap: true, units: [] });
  });

  it("rekening kosong ditandai belum lengkap", () => {
    const p = kelompokkanPenerima([akun({ bank_nama: null, no_rekening: null })], 5_000_000);
    expect(p[0].rekening_lengkap).toBe(false);
  });
});

describe("hitungRingkasan", () => {
  // Angka 1-25 Oktober 2026 yang sudah dikirim owner ke investor.
  const r = hitungRingkasan({
    revenue: 90_068_452,
    malam_terisi: 210,
    cogs: 20_957_370,
    cogs_per_malam: 99_797,
    opex: 8_467_742,
    opex_rincian: [
      { peran: "Cleaning service", orang: 2 },
      { peran: "Receptionist", orang: 3 },
      { peran: "Security", orang: 2 },
    ],
    per_investor_amount: 3_265_411,
    jaminan_topup: 1_734_589,
  });
  it("OPEX di atas 25% -- kelebihannya ditanggung Loonars", () => {
    expect(r).toMatchObject({ opex_total: 29_425_112, opex_pct: 32.7, target_opex: 22_517_113, kelebihan_opex: 6_907_999, staf_orang: 7 });
  });
  it("tidak membawa angka komisi OTA atau pendapatan kotor", () => {
    expect(Object.keys(r).some((k) => /kotor|komisi|(^|_)ota(_|$)|gross/i.test(k))).toBe(false);
  });
});

describe("teks", () => {
  it("nomor bukti memuat periode dan unit", () => {
    expect(nomorBukti({ periode: "2026-10", units: ["A5", "C3"], tetap: false })).toBe("LNR/BH/2610/A5-C3");
    expect(nomorBukti({ periode: "2026-10", units: [], tetap: true })).toBe("LNR/BH/2610/TETAP");
  });
  it("pengantar menyebut nama dan periode", () => {
    expect(teksPengantar("MUSAFA", "2026-10")).toContain("Bapak/Ibu MUSAFA");
    expect(teksPengantar("MUSAFA", "2026-10")).toContain("periode Oktober 2026");
  });
});
