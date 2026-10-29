import { describe, expect, it } from "vitest";
import { cocokkanMutasi, kenaliSumber, type MutasiBaris } from "./mutasiBank";
import type { PencairanGroup } from "./financePencairan";

function group(p: Partial<PencairanGroup> & { tanggal: string; sumber: string; belum: number }): PencairanGroup {
  return {
    key: `${p.tanggal}|${p.sumber}`,
    items: [],
    count: 1,
    seharusnya: p.belum,
    diterima: 0,
    count_masuk: 0,
    count_belum: 1,
    berjalan: false,
    ...p,
  };
}

function masuk(tanggal: string, keterangan: string, nominal: number): MutasiBaris {
  return { tanggal, keterangan, nominal, arah: "masuk" };
}

describe("kenaliSumber", () => {
  it("mengenali nama OTA di keterangan transfer", () => {
    expect(kenaliSumber("TRF INCOMING BOOKING.COM B.V. PAYOUT")).toBe("booking.com");
    expect(kenaliSumber("Agoda Company Pte Ltd")).toBe("agoda");
    expect(kenaliSumber("PT TRINUSA TRAVELINDO")).toBe("traveloka");
    expect(kenaliSumber("Transfer dari BUDI")).toBeNull();
  });
});

describe("cocokkanMutasi", () => {
  const bdc29 = group({ tanggal: "2026-10-29", sumber: "booking.com", belum: 8954169, count: 25, count_belum: 25 });
  const bdc22 = group({ tanggal: "2026-10-22", sumber: "booking.com", belum: 8800000, count: 20, count_belum: 20 });

  it("memasangkan transfer Booking.com ke pencairan terdekat dan menghitung selisih", () => {
    const [h] = cocokkanMutasi([masuk("2026-10-29", "BOOKING.COM", 8700000)], [bdc22, bdc29]);
    expect(h.group?.key).toBe(bdc29.key);
    expect(h.status).toBe("selisih");
    expect(h.selisih).toBe(8700000 - 8954169);
  });

  it("selisih pembulatan kecil dianggap cocok", () => {
    const [h] = cocokkanMutasi([masuk("2026-10-30", "BOOKING.COM", 8954000)], [bdc29]);
    expect(h.status).toBe("cocok");
  });

  it("dua transfer mingguan tidak berebut pencairan yang sama", () => {
    const hasil = cocokkanMutasi([masuk("2026-10-29", "booking.com", 8954169), masuk("2026-10-23", "booking.com", 8954169)], [bdc22, bdc29]);
    expect(hasil.map((h) => h.group?.key)).toEqual([bdc29.key, bdc22.key]);
  });

  it("tidak mengusulkan channel lain, tanggal terlalu jauh, atau nominal terlalu beda", () => {
    expect(cocokkanMutasi([masuk("2026-10-29", "AGODA", 8954169)], [bdc29])[0].status).toBe("tidak_ketemu");
    expect(cocokkanMutasi([masuk("2026-11-15", "BOOKING.COM", 8954169)], [bdc29])[0].status).toBe("tidak_ketemu");
    expect(cocokkanMutasi([masuk("2026-10-29", "BOOKING.COM", 5000000)], [bdc29])[0].status).toBe("tidak_ketemu");
  });

  it("tanpa nama OTA hanya mengusulkan kalau nominalnya nyaris sama", () => {
    expect(cocokkanMutasi([masuk("2026-10-29", "TRF 0291", 8954169)], [bdc29])[0].group?.key).toBe(bdc29.key);
    expect(cocokkanMutasi([masuk("2026-10-29", "TRF 0291", 8500000)], [bdc29])[0].status).toBe("tidak_ketemu");
  });

  it("menandai pencairan yang sudah dicentang sebelumnya dan mengabaikan uang keluar", () => {
    const lengkap = { ...bdc29, count_belum: 0, count_masuk: 25, belum: 0, diterima: 8954169 };
    const hasil = cocokkanMutasi(
      [masuk("2026-10-29", "BOOKING.COM", 8954169), { tanggal: "2026-10-29", keterangan: "BOOKING.COM", nominal: 8954169, arah: "keluar" }],
      [lengkap],
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].status).toBe("sudah_tercatat");
  });
});
