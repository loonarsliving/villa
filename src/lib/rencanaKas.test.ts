import { describe, expect, it } from "vitest";
import { akhirBulanISO, hitungRencanaKas } from "./rencanaKas";
import type { FinanceChecklistItem } from "./types";

function item(o: Partial<FinanceChecklistItem>): FinanceChecklistItem {
  return {
    booking_id: Math.random().toString(36).slice(2),
    unit_nomor: "A1",
    guest_nama: "Tamu",
    sumber: "booking.com",
    normalized_channel: "BOOKING_COM",
    tgl_checkin: "2026-10-10",
    tgl_checkout: "2026-10-12",
    malam: 2,
    kotor: 0,
    seharusnya: 1_000_000,
    cloudbeds_reservation_id: null,
    masuk: false,
    settlement_status: "PENDING",
    expected_settlement_date: null,
    amount_received: null,
    received_date: null,
    bank_reference: null,
    variance_amount: null,
    notes: null,
    ...o,
  };
}

const dasar = { hariIni: "2026-10-21", pipeline: 0, netBulanIni: 74_500_000, saldo: 30_000_000, unitDividen: 9, asumsiPerHari: 5_000_000 };

describe("akhirBulanISO", () => {
  it("memakai jumlah hari bulan itu", () => {
    expect(akhirBulanISO("2026-10-21")).toBe("2026-10-31");
    expect(akhirBulanISO("2026-02-03")).toBe("2026-02-28");
  });
});

describe("hitungRencanaKas", () => {
  it("memisahkan sudah cair, akan cair, lewat tempo, tertahan, dan tanpa jadwal", () => {
    const r = hitungRencanaKas({
      ...dasar,
      items: [
        item({ masuk: true, amount_received: 9_000_000, received_date: "2026-10-16", settlement_status: "RECEIVED" }),
        item({ masuk: true, amount_received: 5_000_000, received_date: "2026-09-30", settlement_status: "RECEIVED" }),
        item({ seharusnya: 15_000_000, expected_settlement_date: "2026-10-22" }),
        item({ seharusnya: 2_000_000, expected_settlement_date: "2026-10-29" }),
        item({ sumber: "airbnb", seharusnya: 3_000_000, expected_settlement_date: "2026-10-15" }),
        item({ sumber: "agoda", seharusnya: 7_000_000, expected_settlement_date: "2026-11-05" }),
        item({ sumber: "agoda", seharusnya: 4_000_000, expected_settlement_date: "2026-11-20" }),
        item({ sumber: "website", seharusnya: 500_000, expected_settlement_date: null }),
      ],
    });
    expect(r.sudahCairBulanIni).toBe(9_000_000);
    expect(r.akanCair).toBe(17_000_000);
    expect(r.akanCairSampaiDividen).toBe(15_000_000);
    expect(r.lewatTempo).toBe(3_000_000);
    expect(r.lewatTempoBooking).toBe(1);
    expect(r.tertahan).toBe(11_000_000);
    expect(r.tertahanPerChannel[0]).toMatchObject({ sumber: "agoda", jumlah: 11_000_000, booking: 2, paling_awal: "2026-11-05", paling_akhir: "2026-11-20" });
    expect(r.tanpaJadwal).toBe(500_000);
  });

  it("dana lewat tempo tidak dihitung lagi sebagai uang yang akan masuk (sudah di saldo)", () => {
    const r = hitungRencanaKas({
      ...dasar,
      items: [item({ seharusnya: 3_000_000, expected_settlement_date: "2026-10-15" })],
    });
    expect(r.akanCair).toBe(0);
    expect(r.sisaKasPasti).toBe(30_000_000 - 45_000_000);
  });

  it("website tanpa jadwal cair = kemungkinan sudah di rekening, bukan dana menyusul; OTA tanpa jadwal tetap tanpa jadwal", () => {
    const r = hitungRencanaKas({
      ...dasar,
      items: [
        item({ sumber: "website", normalized_channel: "DIRECT", seharusnya: 4_800_000, expected_settlement_date: null }),
        item({ sumber: "cloudbeds", normalized_channel: "UNKNOWN", seharusnya: 1_200_000, expected_settlement_date: null }),
      ],
    });
    expect(r.lewatTempo).toBe(4_800_000);
    expect(r.tanpaJadwal).toBe(1_200_000);
    expect(r.piutang).toBe(1_200_000);
  });

  it("saldo + cair sampai tgl 25 dibanding dividen garansi 9 unit x Rp5 jt", () => {
    const r = hitungRencanaKas({
      ...dasar,
      items: [
        item({ seharusnya: 15_100_000, expected_settlement_date: "2026-10-22" }),
        item({ seharusnya: 2_400_000, expected_settlement_date: "2026-10-29" }),
      ],
    });
    expect(r.dividen).toBe(45_000_000);
    expect(r.tersediaSaatDividen).toBe(45_100_000);
    expect(r.selisihDividen).toBe(100_000);
    expect(r.sisaKasPasti).toBe(30_000_000 + 17_500_000 - 45_000_000);
  });

  it("potensi sisa bulan: booking yang sudah ada bagian dari asumsi, bukan tambahan", () => {
    const r = hitungRencanaKas({ ...dasar, pipeline: 16_200_000, items: [] });
    expect(r.sisaHari).toBe(10);
    expect(r.potensiAsumsi).toBe(50_000_000);
    expect(r.potensiTambahan).toBe(33_800_000);
    expect(r.potensiTotal).toBe(50_000_000);
  });

  it("booking lebih besar dari asumsi: potensi = booking, tambahan 0", () => {
    const r = hitungRencanaKas({ ...dasar, hariIni: "2026-10-30", pipeline: 9_000_000, items: [] });
    expect(r.sisaHari).toBe(1);
    expect(r.potensiTambahan).toBe(0);
    expect(r.potensiTotal).toBe(9_000_000);
  });

  it("posisi total = sisa kas pasti + dana tertahan + potensi", () => {
    const r = hitungRencanaKas({
      ...dasar,
      pipeline: 16_200_000,
      items: [
        item({ seharusnya: 15_100_000, expected_settlement_date: "2026-10-22" }),
        item({ sumber: "agoda", seharusnya: 36_000_000, expected_settlement_date: "2026-11-10" }),
      ],
    });
    expect(r.sisaKasPasti).toBe(30_000_000 + 15_100_000 - 45_000_000);
    expect(r.posisiTotal).toBe(r.sisaKasPasti + 36_000_000 + 50_000_000);
  });

  it("rata-rata harian nyata = net bulan ini / tanggal hari ini", () => {
    expect(hitungRencanaKas({ ...dasar, items: [] }).rataRataHarianNyata).toBeCloseTo(74_500_000 / 21, 6);
  });

  it("lewat tanggal 25: yang tersedia saat dividen hanya saldo", () => {
    const r = hitungRencanaKas({
      ...dasar,
      hariIni: "2026-10-27",
      items: [item({ seharusnya: 2_000_000, expected_settlement_date: "2026-10-29" })],
    });
    expect(r.tersediaSaatDividen).toBe(30_000_000);
    expect(r.akanCair).toBe(2_000_000);
  });
});
