import { describe, expect, it } from "vitest";
import { hitungLaporan, malamKamar, pendapatanPerMinggu, periodeMingguLalu, porsi, strategiUntuk, teksLaporan, type BookingRingkas } from "./investorWeeklyReportText";

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
  it("pendapatan = uang diterima villa: OTA = subtotal Cloudbeds dikurangi komisi, langsung = total_bayar", () => {
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
      { "booking.com": 23.0746 },
    );
    expect(l.pendapatan).toBe(Math.round(447950 * (1 - 0.230746)) + 600000);
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
  it("memuat angka utama dan target", () => {
    const l = hitungLaporan([bk({})], 13, { mulai: "2026-09-30", akhir: "2026-10-06" }, wib);
    const t = teksLaporan(l);
    expect(t).toContain("Minggu ke-1 Oktober: 30 Sep – 6 Okt 2026");
    expect(t).toContain("Mulai minggu ini");
    expect(t).toContain("Pendapatan villa minggu ini: *Rp500.000*");
    expect(t).not.toMatch(/fee OTA|kotor|marketing/i);
    expect(t).toContain("Agoda: 100% (1 booking)");
    expect(t).not.toContain("Total Pendapatan"); // perMinggu tidak diisi
    expect(t).toContain("okupansi 80% di akhir 2026");
    expect(t).not.toMatch(/airbnb.*rencana/i);
  });
  it("minggu berikutnya tanpa kalimat pembuka", () => {
    const l = hitungLaporan([], 13, { mulai: "2026-10-07", akhir: "2026-10-13" }, wib);
    const t = teksLaporan(l);
    expect(t).toContain("Minggu ke-2 Oktober");
    expect(t).not.toContain("Mulai minggu ini");
  });
});

describe("pendapatan bulan berjalan", () => {
  const p3 = { mulai: "2026-10-14", akhir: "2026-10-20" };
  const data = [
    bk({ tgl_checkin: "2026-09-30", tgl_checkout: "2026-10-01", total_bayar: 1_000_000 }),
    bk({ tgl_checkin: "2026-10-01", tgl_checkout: "2026-10-02", total_bayar: 500_000 }),
    bk({ tgl_checkin: "2026-10-13", tgl_checkout: "2026-10-14", total_bayar: 2_000_000 }),
    bk({ tgl_checkin: "2026-10-20", tgl_checkout: "2026-10-21", total_bayar: 4_000_000 }),
    bk({ tgl_checkin: "2026-10-15", tgl_checkout: "2026-10-16", status: "batal", total_bayar: 9_000_000 }),
    bk({ tgl_checkin: "2026-10-30", tgl_checkout: "2026-10-31", total_bayar: 3_000_000 }),
    bk({ tgl_checkin: "2026-11-02", tgl_checkout: "2026-11-03", total_bayar: 700_000 }),
  ];
  it("nomor minggu mulai lagi tiap bulan, ikut bulan tanggal akhir", () => {
    expect(hitungLaporan([], 13, { mulai: "2026-10-28", akhir: "2026-11-03" }, wib).mingguKe).toBe(1);
    expect(hitungLaporan([], 13, { mulai: "2026-11-18", akhir: "2026-11-24" }, wib).mingguKe).toBe(4);
    expect(hitungLaporan([], 13, { mulai: "2026-11-25", akhir: "2026-12-01" }, wib).mingguKe).toBe(1);
    expect(hitungLaporan([], 13, { mulai: "2026-12-23", akhir: "2026-12-29" }, wib).mingguKe).toBe(5);
  });
  it("per minggu hanya di bulan ini, minggu pertama dipotong mulai tgl 1", () => {
    const pm = pendapatanPerMinggu(data, p3);
    expect(pm.map((m) => [m.mingguKe, m.mulai, m.akhir])).toEqual([
      [1, "2026-10-01", "2026-10-06"],
      [2, "2026-10-07", "2026-10-13"],
      [3, "2026-10-14", "2026-10-20"],
    ]);
    expect(pm.map((m) => m.pendapatan)).toEqual([500_000, 2_000_000, 4_000_000]);
  });
  it("teks memuat total bulan, rincian, dan catatan potongan OTA di 20 Okt", () => {
    const l = hitungLaporan(data, 13, p3, wib);
    l.perMinggu = pendapatanPerMinggu(data, p3);
    const t = teksLaporan(l);
    expect(t).toContain("Minggu ke-3 Oktober");
    expect(t).toContain("Pendapatan villa minggu ini: *Rp4.000.000*");
    expect(t).toContain("Total Pendapatan Oktober* (1 Okt – 20 Okt)");
    expect(t).toContain("• Minggu ke-1: Rp500.000");
    expect(t).toContain("*Total: Rp6.500.000*");
    expect(t).toContain("potongan OTA");
    expect(t).not.toMatch(/marketing/i);
  });
  it("minggu silang bulan: kinerja minggu utuh, total bulan baru mulai tgl 1", () => {
    const p = { mulai: "2026-10-28", akhir: "2026-11-03" };
    const l = hitungLaporan(data, 13, p, wib);
    l.perMinggu = pendapatanPerMinggu(data, p);
    const t = teksLaporan(l);
    expect(t).toContain("Minggu ke-1 November: 28 Okt – 3 Nov 2026");
    expect(t).toContain("Pendapatan villa minggu ini: *Rp3.700.000*");
    expect(t).toContain("Total Pendapatan November* (1 Nov – 3 Nov)");
    expect(t).toContain("*Total: Rp700.000*");
    expect(t).not.toContain("• Minggu ke-1:");
    expect(t).not.toContain("potongan OTA");
    expect(t).not.toContain("Mulai minggu ini");
  });
});

describe("strategi mingguan", () => {
  const p = { mulai: "2026-10-14", akhir: "2026-10-20" };
  it("hanya dipakai untuk minggu yang sama", () => {
    expect(strategiUntuk(p, { minggu_akhir: "2026-10-20", poin: ["A", " ", "B"] })).toEqual(["A", "B"]);
    expect(strategiUntuk(p, { minggu_akhir: "2026-10-13", poin: ["lama"] })).toEqual([]);
    expect(strategiUntuk(p, null)).toEqual([]);
  });
  it("tanpa strategi disetujui: bagian strategi hilang, target tetap", () => {
    const t = teksLaporan(hitungLaporan([], 13, p, wib));
    expect(t).not.toContain("Strategi yang Kami Jalankan");
    expect(t).not.toContain("KOL");
    expect(t).toContain("okupansi 80% di akhir 2026");
  });
  it("dengan strategi disetujui", () => {
    const l = hitungLaporan([], 13, p, wib);
    l.strategi = ["Paket BBQ keluarga diluncurkan."];
    expect(teksLaporan(l)).toContain("🚀 *Strategi yang Kami Jalankan Minggu Ini*\n• Paket BBQ keluarga diluncurkan.");
  });
});
