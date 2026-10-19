/**
 * COGS standar per kamar/malam dan laba rugi sederhana untuk /finance.
 *
 * Owner 2026-10-19: dashboard Finance harus menampilkan Revenue → COGS →
 * Gross Profit → Net Profit dengan rincian COGS yang jelas. COGS terdiri
 * dari biaya langsung per malam terjual (listrik kamar, laundry, amenities)
 * ditambah biaya tetap pendukung (internet, listrik receptionist,
 * Cloudbeds) yang dialokasikan per malam memakai okupansi standar minimum
 * 37,9% sebagai acuan -- supaya biaya tetap itu ikut masuk COGS.
 *
 * Owner memilih "COGS standar saja": COGS = COGS standar x malam terisi,
 * tanpa koreksi okupansi. OPEX = gaji staf (PAYROLL_STAF).
 *
 * Rumus ini SAMA dengan bagi hasil investor di villa-api computeReport
 * (owner 2026-10-19, semua bulan). Konstanta di sini dan di villa-api
 * (COGS_BIAYA_LANGSUNG, COGS_BIAYA_TETAP_BULANAN, PAYROLL_STAF) harus sama;
 * kalau satu berubah, ubah keduanya.
 */

export const OKUPANSI_STANDAR_PCT = 37.9;
/** Hari per bulan untuk alokasi biaya tetap -- sama dengan payroll villa-api (days / 30). */
export const HARI_PER_BULAN = 30;

export interface KomponenCogs {
  key: string;
  label: string;
  penjelasan: string;
  /** Rp per malam terjual (biaya langsung) atau Rp per bulan (biaya tetap). */
  nominal: number;
}

export const BIAYA_LANGSUNG: KomponenCogs[] = [
  { key: "listrik_kamar", label: "Listrik kamar", penjelasan: "Pemakaian listrik kamar selama tamu menginap.", nominal: 25_000 },
  { key: "laundry", label: "Laundry", penjelasan: "Cuci sprei, sarung bantal, dan handuk setiap kamar terjual.", nominal: 35_000 },
  { key: "amenities", label: "Amenities", penjelasan: "Perlengkapan untuk tamu di kamar.", nominal: 5_000 },
];

export const BIAYA_TETAP_BULANAN: KomponenCogs[] = [
  { key: "internet", label: "Internet keseluruhan", penjelasan: "WiFi seluruh villa, dipakai tamu di semua kamar.", nominal: 650_000 },
  { key: "listrik_receptionist", label: "Listrik receptionist", penjelasan: "Listrik area lobby/receptionist yang melayani tamu.", nominal: 3_000_000 },
  { key: "cloudbeds", label: "Layanan Cloudbeds", penjelasan: "Langganan PMS & channel manager untuk penjualan kamar ke OTA.", nominal: 1_500_000 },
];

export interface CogsStandar {
  totalKamar: number;
  malamStandarPerBulan: number;
  biayaLangsungPerMalam: number;
  biayaTetapPerBulan: number;
  alokasiTetapPerMalam: number;
  cogsPerMalam: number;
}

export function hitungCogsStandar(totalKamar: number): CogsStandar {
  const malamStandarPerBulan = Math.round(totalKamar * HARI_PER_BULAN * (OKUPANSI_STANDAR_PCT / 100));
  const biayaLangsungPerMalam = BIAYA_LANGSUNG.reduce((s, k) => s + k.nominal, 0);
  const biayaTetapPerBulan = BIAYA_TETAP_BULANAN.reduce((s, k) => s + k.nominal, 0);
  const alokasiTetapPerMalam = malamStandarPerBulan > 0 ? Math.round(biayaTetapPerBulan / malamStandarPerBulan) : 0;
  return {
    totalKamar,
    malamStandarPerBulan,
    biayaLangsungPerMalam,
    biayaTetapPerBulan,
    alokasiTetapPerMalam,
    cogsPerMalam: biayaLangsungPerMalam + alokasiTetapPerMalam,
  };
}

export interface StafPayroll {
  peran: string;
  orang: number;
  gajiPerOrang: number;
}

/** Villa mulai beroperasi; gaji sebelum tanggal ini tidak dihitung (sama dengan villa-api). */
export const VILLA_MULAI_OPERASI = "2026-09-20";

/** Staf yang dipekerjakan per 2026-10-19 (owner). */
export const PAYROLL_STAF: StafPayroll[] = [
  { peran: "Cleaning service", orang: 2, gajiPerOrang: 1_500_000 },
  { peran: "Receptionist", orang: 3, gajiPerOrang: 1_500_000 },
  { peran: "Security", orang: 2, gajiPerOrang: 1_500_000 },
];

function hariDalamBulan(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Bagian bulan yang tercakup rentang [from, to] (inklusif), dijumlah per
 * hari: tiap hari = 1/jumlah hari bulannya. Satu bulan penuh = 1; tanggal 1
 * s/d 19 Oktober = 19/31 -- sama dengan prorata bulan berjalan di villa-api.
 */
export function faktorBulan(from: string, to: string): number {
  let f = 0;
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    f += 1 / hariDalamBulan(d.toISOString().slice(0, 10));
  }
  return f;
}

export interface PayrollPeriode extends StafPayroll {
  perBulan: number;
  periode: number;
}

export function payrollPeriode(from: string, to: string): PayrollPeriode[] {
  const mulai = from < VILLA_MULAI_OPERASI ? VILLA_MULAI_OPERASI : from;
  const f = mulai <= to ? faktorBulan(mulai, to) : 0;
  return PAYROLL_STAF.map((p) => ({ ...p, perBulan: p.orang * p.gajiPerOrang, periode: Math.round(p.orang * p.gajiPerOrang * f) }));
}

export interface LabaRugiInput {
  totalKamar: number;
  hariPeriode: number;
  malamTerjual: number;
  grossRevenue: number;
  komisiOta: number;
  netRevenue: number;
  /** OPEX periode (payrollPeriode). Listrik kamar TIDAK masuk sini karena sudah di COGS. */
  payroll: number;
}

export interface LabaRugi {
  standar: CogsStandar;
  grossRevenue: number;
  komisiOta: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
  opex: number;
  netProfit: number;
  netMarginPct: number | null;
  okupansiPct: number | null;
}

export function hitungLabaRugi(i: LabaRugiInput): LabaRugi {
  const standar = hitungCogsStandar(i.totalKamar);
  const cogs = standar.cogsPerMalam * i.malamTerjual;
  const grossProfit = i.netRevenue - cogs;
  const opex = i.payroll;
  const netProfit = grossProfit - opex;
  const tersedia = i.totalKamar * i.hariPeriode;
  return {
    standar,
    grossRevenue: i.grossRevenue,
    komisiOta: i.komisiOta,
    netRevenue: i.netRevenue,
    cogs,
    grossProfit,
    grossMarginPct: i.netRevenue > 0 ? (grossProfit / i.netRevenue) * 100 : null,
    opex,
    netProfit,
    netMarginPct: i.netRevenue > 0 ? (netProfit / i.netRevenue) * 100 : null,
    okupansiPct: tersedia > 0 ? (i.malamTerjual / tersedia) * 100 : null,
  };
}
