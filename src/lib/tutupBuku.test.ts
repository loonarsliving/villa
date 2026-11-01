import { describe, expect, it } from "vitest";
import { bandingkanDenganSnapshot, hariLewat, piutangPerOta, umurPiutang } from "./tutupBuku";
import type { FinanceChecklistItem, TutupBukuPiutang } from "./types";

let n = 0;
function item(p: Partial<FinanceChecklistItem>): FinanceChecklistItem {
  return {
    booking_id: `b${++n}`,
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

function snap(i: FinanceChecklistItem): TutupBukuPiutang {
  return {
    booking_id: i.booking_id,
    guest_nama: i.guest_nama,
    unit_nomor: i.unit_nomor,
    sumber: i.sumber,
    cloudbeds_reservation_id: i.cloudbeds_reservation_id,
    tgl_checkin: i.tgl_checkin,
    tgl_checkout: i.tgl_checkout,
    seharusnya: i.seharusnya,
    expected_settlement_date: i.expected_settlement_date,
  };
}

describe("umurPiutang", () => {
  const today = "2026-11-01";
  it("membagi menurut hari lewat dari perkiraan cair", () => {
    expect(umurPiutang(null, today)).toBe("tanpa_tanggal");
    expect(umurPiutang("2026-11-05", today)).toBe("belum_jatuh_tempo");
    expect(umurPiutang("2026-11-01", today)).toBe("belum_jatuh_tempo");
    expect(umurPiutang("2026-10-31", today)).toBe("lewat_1_7");
    expect(umurPiutang("2026-10-25", today)).toBe("lewat_1_7");
    expect(umurPiutang("2026-10-24", today)).toBe("lewat_8_30");
    expect(umurPiutang("2026-10-02", today)).toBe("lewat_8_30");
    expect(umurPiutang("2026-10-01", today)).toBe("lewat_30");
  });
  it("hari lewat melintasi akhir bulan", () => {
    expect(hariLewat("2026-10-30", "2026-11-02")).toBe(3);
    expect(hariLewat("2026-11-10", "2026-11-02")).toBe(-8);
    expect(hariLewat(null, "2026-11-02")).toBeNull();
  });
});

describe("piutangPerOta", () => {
  it("mengelompokkan per OTA, total per umur, OTA terbesar di atas, paling lama lewat di atas", () => {
    const today = "2026-11-01";
    const list = [
      item({ sumber: "agoda", seharusnya: 500, expected_settlement_date: "2026-11-20" }),
      item({ sumber: "booking.com", seharusnya: 100, expected_settlement_date: "2026-10-29" }),
      item({ sumber: "booking.com", seharusnya: 200, expected_settlement_date: "2026-10-10" }),
      item({ sumber: "booking.com", seharusnya: 300, expected_settlement_date: null }),
      item({ sumber: null, seharusnya: 50, expected_settlement_date: "2026-09-01" }),
    ];
    const g = piutangPerOta(list, today);
    expect(g.map((x) => x.sumber)).toEqual(["booking.com", "agoda", "-"]);
    const bdc = g[0];
    expect(bdc.total).toBe(600);
    expect(bdc.count).toBe(3);
    expect(bdc.per_umur.lewat_8_30).toEqual({ count: 1, total: 200 });
    expect(bdc.per_umur.lewat_1_7).toEqual({ count: 1, total: 100 });
    expect(bdc.per_umur.tanpa_tanggal).toEqual({ count: 1, total: 300 });
    expect(bdc.baris.map((b) => b.hari_lewat)).toEqual([22, 3, null]);
    expect(g[1].per_umur.belum_jatuh_tempo.total).toBe(500);
    expect(g[2].per_umur.lewat_30.total).toBe(50);
  });
});

describe("bandingkanDenganSnapshot", () => {
  it("menandai yang cair setelah tutup buku, sisa piutang, belum cair baru, dan yang hilang", () => {
    const a = item({ seharusnya: 100 });
    const b = item({ seharusnya: 200 });
    const c = item({ seharusnya: 300 });
    const sudahMasukSaatTutup = item({ seharusnya: 400, masuk: true, amount_received: 400 });
    const snapshot = [snap(a), snap(b), snap(c)];
    const live = [
      { ...a, masuk: true, amount_received: 95, received_date: "2026-11-03" },
      b,
      // dicentang saat tutup, lalu centangnya dibatalkan
      { ...sudahMasukSaatTutup, masuk: false, amount_received: null },
    ];
    const r = bandingkanDenganSnapshot(snapshot, live);
    expect(r.cair_setelah_tutup.map((i) => i.booking_id)).toEqual([a.booking_id]);
    expect(r.total_cair_setelah_tutup).toBe(95);
    expect(r.masih_piutang.map((i) => i.booking_id)).toEqual([b.booking_id]);
    expect(r.total_masih_piutang).toBe(200);
    expect(r.belum_cair_baru.map((i) => i.booking_id)).toEqual([sudahMasukSaatTutup.booking_id]);
    expect(r.hilang.map((i) => i.booking_id)).toEqual([c.booking_id]);
  });
});
