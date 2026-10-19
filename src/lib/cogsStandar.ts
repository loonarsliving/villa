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
 * Akibatnya: kalau okupansi periode di bawah 37,9%, sebagian biaya tetap
 * belum terserap COGS. Selisih itu dicatat sebagai OPEX ("biaya tetap belum
 * terserap") supaya Net Profit tetap jujur; kalau okupansi di atas standar
 * selisihnya negatif (biaya tetap terserap lebih).
 *
 * Murni tampilan analisis Finance: tidak dipakai untuk harga, bagi hasil,
 * atau dividen investor (rumus beku tetap di villa-api computeReport).
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

export interface LabaRugiInput {
  totalKamar: number;
  hariPeriode: number;
  malamTerjual: number;
  grossRevenue: number;
  komisiOta: number;
  netRevenue: number;
  /** Payroll periode (villa-api opex_breakdown.payroll). Listrik kamar TIDAK masuk sini karena sudah di COGS. */
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
  payroll: number;
  biayaTetapAktual: number;
  biayaTetapTerserap: number;
  biayaTetapBelumTerserap: number;
  opex: number;
  netProfit: number;
  netMarginPct: number | null;
  okupansiPct: number | null;
}

export function hitungLabaRugi(i: LabaRugiInput): LabaRugi {
  const standar = hitungCogsStandar(i.totalKamar);
  const cogs = standar.cogsPerMalam * i.malamTerjual;
  const grossProfit = i.netRevenue - cogs;
  const biayaTetapAktual = Math.round(standar.biayaTetapPerBulan * (i.hariPeriode / HARI_PER_BULAN));
  const biayaTetapTerserap = standar.alokasiTetapPerMalam * i.malamTerjual;
  const biayaTetapBelumTerserap = biayaTetapAktual - biayaTetapTerserap;
  const opex = i.payroll + biayaTetapBelumTerserap;
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
    payroll: i.payroll,
    biayaTetapAktual,
    biayaTetapTerserap,
    biayaTetapBelumTerserap,
    opex,
    netProfit,
    netMarginPct: i.netRevenue > 0 ? (netProfit / i.netRevenue) * 100 : null,
    okupansiPct: tersedia > 0 ? (i.malamTerjual / tersedia) * 100 : null,
  };
}
