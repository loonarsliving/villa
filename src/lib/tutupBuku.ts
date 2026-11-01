import type { FinanceChecklistItem, TutupBukuPiutang } from "@/lib/types";

/**
 * Hitungan murni untuk halaman Tutup Buku (owner 2026-11-01): "melihat mana
 * saja yang belum cair dari OTA mana saja di bulan itu" + bantuan untuk
 * mengetahui yang mana belum cair (owner memilih "Daftar per OTA + umur").
 *
 * Tidak ada angka uang baru di sini: "seharusnya" dan tanggal perkiraan cair
 * diambil apa adanya dari finance_settlements (lewat /finance/checklist-dana
 * dan snapshot tutup buku). File ini hanya mengelompokkan dan menghitung
 * umur hari.
 */

export type UmurPiutang = "tanpa_tanggal" | "belum_jatuh_tempo" | "lewat_1_7" | "lewat_8_30" | "lewat_30";

export const URUTAN_UMUR: UmurPiutang[] = ["lewat_30", "lewat_8_30", "lewat_1_7", "belum_jatuh_tempo", "tanpa_tanggal"];

export const LABEL_UMUR: Record<UmurPiutang, string> = {
  lewat_30: "Lewat > 30 hari",
  lewat_8_30: "Lewat 8-30 hari",
  lewat_1_7: "Lewat 1-7 hari",
  belum_jatuh_tempo: "Belum jatuh tempo",
  tanpa_tanggal: "Tanggal cair belum diatur",
};

/** Selisih hari kalender (b - a) untuk tanggal "YYYY-MM-DD". */
export function selisihHari(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Hari lewat dari perkiraan cair; negatif = belum jatuh tempo, null = tanggal belum diatur. */
export function hariLewat(expected: string | null, today: string): number | null {
  return expected ? selisihHari(expected, today) : null;
}

export function umurPiutang(expected: string | null, today: string): UmurPiutang {
  const h = hariLewat(expected, today);
  if (h == null) return "tanpa_tanggal";
  if (h <= 0) return "belum_jatuh_tempo";
  if (h <= 7) return "lewat_1_7";
  if (h <= 30) return "lewat_8_30";
  return "lewat_30";
}

type ItemPiutang = Pick<
  FinanceChecklistItem,
  "booking_id" | "guest_nama" | "unit_nomor" | "sumber" | "cloudbeds_reservation_id" | "tgl_checkin" | "tgl_checkout" | "seharusnya" | "expected_settlement_date"
>;

export interface BarisPiutang<T extends ItemPiutang = ItemPiutang> {
  item: T;
  umur: UmurPiutang;
  hari_lewat: number | null;
}

export interface PiutangOta<T extends ItemPiutang = ItemPiutang> {
  sumber: string;
  count: number;
  total: number;
  /** Total & jumlah per kelompok umur. */
  per_umur: Record<UmurPiutang, { count: number; total: number }>;
  /** Paling lama lewat di atas; yang belum diatur tanggalnya paling bawah. */
  baris: BarisPiutang<T>[];
}

function umurKosong(): Record<UmurPiutang, { count: number; total: number }> {
  return {
    lewat_30: { count: 0, total: 0 },
    lewat_8_30: { count: 0, total: 0 },
    lewat_1_7: { count: 0, total: 0 },
    belum_jatuh_tempo: { count: 0, total: 0 },
    tanpa_tanggal: { count: 0, total: 0 },
  };
}

/** Booking belum cair dikelompokkan per OTA, OTA dengan piutang terbesar di atas. */
export function piutangPerOta<T extends ItemPiutang>(items: T[], today: string): PiutangOta<T>[] {
  const map = new Map<string, PiutangOta<T>>();
  for (const item of items) {
    const sumber = item.sumber ?? "-";
    let g = map.get(sumber);
    if (!g) {
      g = { sumber, count: 0, total: 0, per_umur: umurKosong(), baris: [] };
      map.set(sumber, g);
    }
    const umur = umurPiutang(item.expected_settlement_date, today);
    g.count++;
    g.total += item.seharusnya;
    g.per_umur[umur].count++;
    g.per_umur[umur].total += item.seharusnya;
    g.baris.push({ item, umur, hari_lewat: hariLewat(item.expected_settlement_date, today) });
  }
  for (const g of map.values()) {
    g.baris.sort((a, b) => {
      if (a.hari_lewat == null && b.hari_lewat == null) return a.item.tgl_checkin.localeCompare(b.item.tgl_checkin);
      if (a.hari_lewat == null) return 1;
      if (b.hari_lewat == null) return -1;
      return b.hari_lewat - a.hari_lewat || a.item.tgl_checkin.localeCompare(b.item.tgl_checkin);
    });
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.sumber.localeCompare(b.sumber));
}

export interface PerbandinganTutupBuku {
  /** Belum cair saat tutup buku, sekarang sudah dicentang masuk. */
  cair_setelah_tutup: FinanceChecklistItem[];
  /** Belum cair saat tutup buku dan masih belum cair = sisa piutang. */
  masih_piutang: FinanceChecklistItem[];
  /**
   * Belum cair sekarang tapi TIDAK ada di daftar piutang saat tutup buku
   * (centangnya dibatalkan setelah tutup buku, atau booking baru tercatat).
   */
  belum_cair_baru: FinanceChecklistItem[];
  /** Ada di piutang saat tutup buku, sekarang tidak ada di bulan itu (mis. dibatalkan / pindah tanggal). */
  hilang: TutupBukuPiutang[];
  total_cair_setelah_tutup: number;
  total_masih_piutang: number;
}

export function bandingkanDenganSnapshot(snapshotPiutang: TutupBukuPiutang[], live: FinanceChecklistItem[]): PerbandinganTutupBuku {
  const liveById = new Map(live.map((i) => [i.booking_id, i]));
  const diSnapshot = new Set(snapshotPiutang.map((p) => p.booking_id));
  const cair_setelah_tutup: FinanceChecklistItem[] = [];
  const masih_piutang: FinanceChecklistItem[] = [];
  const hilang: TutupBukuPiutang[] = [];
  for (const p of snapshotPiutang) {
    const now = liveById.get(p.booking_id);
    if (!now) hilang.push(p);
    else if (now.masuk) cair_setelah_tutup.push(now);
    else masih_piutang.push(now);
  }
  const belum_cair_baru = live.filter((i) => !i.masuk && !diSnapshot.has(i.booking_id));
  return {
    cair_setelah_tutup,
    masih_piutang,
    belum_cair_baru,
    hilang,
    total_cair_setelah_tutup: cair_setelah_tutup.reduce((a, i) => a + (i.amount_received ?? 0), 0),
    total_masih_piutang: masih_piutang.reduce((a, i) => a + i.seharusnya, 0),
  };
}
