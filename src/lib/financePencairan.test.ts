import { describe, expect, it } from "vitest";
import { kelompokkanPerPencairan, rentangCheckinUntukPencairan } from "./financePencairan";
import type { FinanceChecklistItem } from "./types";

function item(p: Partial<FinanceChecklistItem>): FinanceChecklistItem {
  return {
    booking_id: Math.random().toString(36).slice(2),
    unit_nomor: "A1",
    guest_nama: "Tamu",
    sumber: "booking.com",
    normalized_channel: "booking.com",
    tgl_checkin: "2026-10-16",
    tgl_checkout: "2026-10-17",
    malam: 1,
    kotor: 0,
    seharusnya: 100,
    cloudbeds_reservation_id: null,
    masuk: false,
    settlement_status: "PENDING",
    expected_settlement_date: "2026-10-22",
    amount_received: null,
    received_date: null,
    bank_reference: null,
    variance_amount: null,
    notes: null,
    ...p,
  };
}

describe("kelompokkanPerPencairan", () => {
  it("menjumlahkan per tanggal cair dan channel, memisahkan yang sudah dan belum dicentang", () => {
    const groups = kelompokkanPerPencairan(
      [
        item({ seharusnya: 100 }),
        item({ seharusnya: 200, masuk: true, amount_received: 190 }),
        item({ seharusnya: 50, sumber: "traveloka" }),
        item({ seharusnya: 70, expected_settlement_date: "2026-10-15" }),
      ],
      "2026-10",
      "2026-10-24",
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-10-15|booking.com", "2026-10-22|booking.com", "2026-10-22|traveloka"]);
    const bdc = groups[1];
    expect(bdc).toMatchObject({ count: 2, seharusnya: 300, diterima: 190, belum: 100, count_masuk: 1, count_belum: 1, berjalan: false });
  });

  it("hanya memuat pencairan di bulan yang dipilih, dan menandai yang masih berjalan", () => {
    const groups = kelompokkanPerPencairan(
      [
        item({ expected_settlement_date: "2026-11-01" }),
        item({ expected_settlement_date: null }),
        item({ expected_settlement_date: "2026-10-29" }),
      ],
      "2026-10",
      "2026-10-24",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ tanggal: "2026-10-29", berjalan: true });
  });
});

describe("rentangCheckinUntukPencairan", () => {
  it("mundur cukup jauh untuk payout Agoda 30 hari setelah checkout", () => {
    expect(rentangCheckinUntukPencairan("2026-10")).toEqual({ from: "2026-07-18", to: "2026-10-31" });
  });
});
