import { describe, expect, it } from "vitest";
import { hitungLaporan, malamKamar, periodeMingguLalu, porsi, teksLaporan, type BookingRingkas } from "./investorWeeklyReportText";

function bk(o: Partial<BookingRingkas>): BookingRingkas {
  return {
    sumber: "agoda",
    status: "checkout",
    unit_nomor: "A1",
    tgl_checkin: "2026-10-01",
    tgl_checkout: "2026-10-02",
    total_bayar: 500000,
    cloudbeds_subtotal: null,
    created_at: "2026-09-20T03:00:00Z",
    ...o,
  };
}

const wib = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

describe("periodeMingguLalu", () => {
  it("7 malam yang berakhir kemarin", () => {
    expect(periodeMingguLalu("2026-10-07")).toEqual({ mulai: "2026-09-30", akhir: "2026-10-06" });
  });
});

describe("malamKamar", () => {
  const p = { mulai: "2026-09-30", akhir: "2026-10-06" };
  it("hanya malam di dalam periode, batal tidak dihitung", () => {
    const b = [
      bk({ tgl_checkin: "2026-09-28", tgl_checkout: "2026-10-02" }), // 30 Sep, 1 Okt
      bk({ unit_nomor: "A2", tgl_checkin: "2026-10-06", tgl_checkout: "2026-10-09" }), // 6 Okt
      bk({ unit_nomor: "A3", status: "batal" }),
    ];
    expect(malamKamar(b, p)).toBe(3);
  });
  it("unit + malam yang sama dihitung sekali", () => {
    expect(malamKamar([bk({}), bk({ sumber: "booking.com" })], p)).toBe(1);
  });
});

describe("porsi", () => {
  it("total selalu 100", () => {
    const r = porsi(["a", "a", "b", "c", "c", "c"]);
    expect(r.reduce((s, x) => s + x.persen, 0)).toBe(100);
    expect(r[0]).toMatchObject({ channel: "c", jumlah: 3, persen: 50 });
  });
});

describe("hitungLaporan", () => {
  const p = { mulai: "2026-09-30", akhir: "2026-10-06" };
  it("bersih memakai cloudbeds_subtotal untuk OTA, kotor untuk website", () => {
    const l = hitungLaporan(
      [
        bk({ sumber: "booking.com", total_bayar: 515142.5, cloudbeds_subtotal: 447950 }),
        bk({ unit_nomor: "B1", sumber: "website", total_bayar: 600000, cloudbeds_subtotal: 550000 }),
        bk({ unit_nomor: "B2", status: "batal", total_bayar: 999999 }),
        bk({ unit_nomor: "B3", tgl_checkin: "2026-10-07", tgl_checkout: "2026-10-08" }),
      ],
      13,
      p,
      wib,
    );
    expect(l.bersih).toBe(447950 + 600000);
    expect(l.kotor).toBe(515142.5 + 600000);
    expect(l.jumlahCheckin).toBe(2);
    expect(l.malamTerisi).toBe(2);
    expect(l.malamTerisiMingguDepan).toBe(1);
    expect(l.mingguKe).toBe(1);
  });
  it("booking baru memakai tanggal WIB dan mengabaikan yang batal", () => {
    const l = hitungLaporan(
      [
        bk({ created_at: "2026-09-29T17:30:00Z", tgl_checkin: "2026-12-01", tgl_checkout: "2026-12-02" }), // 30 Sep 00:30 WIB
        bk({ created_at: "2026-09-29T16:30:00Z", tgl_checkin: "2026-12-01", tgl_checkout: "2026-12-02" }), // 29 Sep WIB
        bk({ status: "batal", created_at: "2026-10-01T03:00:00Z" }),
      ],
      13,
      p,
      wib,
    );
    expect(l.jumlahBookingBaru).toBe(1);
  });
});

describe("teksLaporan", () => {
  it("memuat angka utama dan strategi KOL", () => {
    const l = hitungLaporan([bk({})], 13, { mulai: "2026-09-30", akhir: "2026-10-06" }, wib);
    const t = teksLaporan(l);
    expect(t).toContain("Minggu ke-1: 30 Sep – 6 Okt 2026");
    expect(t).toContain("Rp500.000");
    expect(t).toContain("Agoda: 100% (1 booking)");
    expect(t).toContain("KOL");
    expect(t).toContain("okupansi 80% di akhir 2026");
    expect(t).not.toMatch(/airbnb.*rencana/i);
  });
  it("minggu berikutnya tanpa kalimat pembuka", () => {
    const l = hitungLaporan([], 13, { mulai: "2026-10-07", akhir: "2026-10-13" }, wib);
    const t = teksLaporan(l);
    expect(t).toContain("Minggu ke-2");
    expect(t).not.toContain("Mulai minggu ini");
  });
});
