import { describe, expect, it } from "vitest";
import { bacaPayoutBookingCom, cocokkanPayout, namaMirip, parseRupiah, parseTanggal, type PayoutBaris } from "./payoutOta";
import type { FinanceChecklistItem } from "./types";

const item = (o: Partial<FinanceChecklistItem>): FinanceChecklistItem => ({
  booking_id: "b1", unit_nomor: "1", guest_nama: "Damian Alvin", sumber: "booking.com", normalized_channel: "BOOKING_COM",
  tgl_checkin: "2026-11-01", tgl_checkout: "2026-11-02", malam: 1, kotor: 430950, seharusnya: 330000, cloudbeds_reservation_id: null,
  masuk: false, settlement_status: "PENDING", expected_settlement_date: "2026-11-03", amount_received: null, received_date: null,
  bank_reference: null, variance_amount: null, notes: null, ...o,
});
const baris = (o: Partial<PayoutBaris>): PayoutBaris => ({ nomor: "6843091061", tipe: "Reservation", tamu: "Damian Alvin", checkin: "2026-11-01", checkout: "2026-11-02", kotor: 430950, net: 324277, reservasi: true, ...o });

describe("parseRupiah", () => {
  it("membaca berbagai format", () => {
    expect(parseRupiah("Rp 1,105,912")).toBe(1105912);
    expect(parseRupiah("-Rp 241,655")).toBe(-241655);
    expect(parseRupiah("389.697,00")).toBe(389697);
    expect(parseRupiah("IDR 1.219.504,00")).toBe(1219504);
    expect(parseRupiah("1410150.00")).toBe(1410150);
    expect(parseRupiah("")).toBeNull();
  });
});

describe("parseTanggal", () => {
  it("membaca berbagai format", () => {
    expect(parseTanggal("Oct 31, 2026")).toBe("2026-10-31");
    expect(parseTanggal("Nov 2, 2026")).toBe("2026-11-02");
    expect(parseTanggal("2026-11-02")).toBe("2026-11-02");
    expect(parseTanggal("02/11/2026")).toBe("2026-11-02");
    expect(parseTanggal("Sep 30, 2026")).toBe("2026-09-30");
  });
});

describe("bacaPayoutBookingCom", () => {
  const csv = [
    "Booking number,Type,Guest name,Check-in,Check-out,Amount,Commission,VAT,Payments Service Fee,Net",
    '6953881895,Reservation,Lawrence Efraim,"Oct 31, 2026","Nov 2, 2026","Rp 1,410,150","-Rp 241,655","-Rp 30,150","-Rp 32,433","Rp 1,105,912"',
    '6843091061,Reservation,Damian Alvin,"Nov 1, 2026","Nov 2, 2026","Rp 430,950","-Rp 86,190","-Rp 10,571","-Rp 9,912","Rp 324,277"',
  ].join("\n");
  it("membaca baris dari CSV", () => {
    const h = bacaPayoutBookingCom(csv);
    expect("rows" in h && h.rows.map((r) => [r.nomor, r.net, r.checkin])).toEqual([
      ["6953881895", 1105912, "2026-10-31"],
      ["6843091061", 324277, "2026-11-01"],
    ]);
  });
  it("menyebut kolom wajib yang hilang", () => {
    const h = bacaPayoutBookingCom("a,b\n1,2");
    expect("galat" in h && h.galat).toContain("nomor");
  });
});

describe("namaMirip", () => {
  it("menerima nama terpotong dan urutan beda, menolak nama lain", () => {
    expect(namaMirip("Mutiara Zalfa Puteri", "Mutiara Zalfa Pute…")).toBe(true);
    expect(namaMirip("Alvin Damian", "Damian Alvin")).toBe(true);
    expect(namaMirip("Budi Setiyawan", "Damian Alvin")).toBe(false);
  });
});

describe("cocokkanPayout", () => {
  it("mencocokkan lewat nama + tanggal, lalu lewat nomor", () => {
    const h1 = cocokkanPayout([baris({})], [item({})], /booking/i);
    expect(h1[0].status).toBe("cocok_nama");
    expect(h1[0].selisih).toBe(324277 - 330000);
    const h2 = cocokkanPayout([baris({ tamu: "Nama Lain Sama Sekali" })], [item({ ota_booking_number: "6843091061" })], /booking/i);
    expect(h2[0].status).toBe("cocok_nomor");
  });
  it("tidak menebak kalau tanggal beda atau kandidat lebih dari satu", () => {
    expect(cocokkanPayout([baris({ checkout: "2026-11-03" })], [item({})], /booking/i)[0].status).toBe("tidak_ketemu");
    expect(cocokkanPayout([baris({})], [item({}), item({ booking_id: "b2" })], /booking/i)[0].status).toBe("ambigu");
  });
  it("tidak mencocokkan channel lain, menandai sudah masuk, duplikat, dan bukan reservasi", () => {
    expect(cocokkanPayout([baris({})], [item({ sumber: "agoda" })], /booking/i)[0].status).toBe("tidak_ketemu");
    expect(cocokkanPayout([baris({})], [item({ masuk: true })], /booking/i)[0].status).toBe("sudah_masuk");
    const d = cocokkanPayout([baris({}), baris({})], [item({})], /booking/i);
    expect(d.map((x) => x.status)).toEqual(["cocok_nama", "duplikat"]);
    expect(cocokkanPayout([baris({ reservasi: false, tipe: "Adjustment" })], [item({})], /booking/i)[0].status).toBe("bukan_reservasi");
  });
  it("Agoda: nomor kecil, tanggal menginap", () => {
    const a = cocokkanPayout(
      [{ nomor: "2054625441", tipe: "Reservation", tamu: "Malinda Mayanti", checkin: "2026-09-30", checkout: "2026-10-01", kotor: null, net: 389697, reservasi: true }],
      [item({ sumber: "agoda", guest_nama: "Malinda Mayanti", tgl_checkin: "2026-09-30", tgl_checkout: "2026-10-01" })],
      /agoda/i,
    );
    expect(a[0].status).toBe("cocok_nama");
  });
});
