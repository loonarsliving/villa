import type { FinanceChecklistItem } from "@/lib/types";

/**
 * Total per hari pencairan untuk Checklist Dana Masuk (owner 2026-10-24:
 * "harusnya ada totalnya jga per hari pencairan agar finance dapat
 * mencocokan jumlahnya").
 *
 * Satu transfer OTA di mutasi bank = satu channel pada satu tanggal cair
 * (mis. payout Booking.com 22 Okt untuk checkout 15-21 Okt), jadi kuncinya
 * pasangan (expected_settlement_date, sumber). Tanggal cair diambil dari
 * finance_settlements yang dihitung villa-api dari Konfigurasi Settlement
 * OTA -- tidak dihitung ulang di sini.
 *
 * Dikelompokkan menurut BULAN TANGGAL CAIR, bukan bulan check-in: payout
 * Agoda 30 hari setelah checkout dan payout Booking.com awal bulan memuat
 * booking yang check-in-nya di bulan sebelumnya. Kalau mengikuti bulan
 * check-in, total pencairan itu terpotong dan tidak akan pernah cocok
 * dengan mutasi.
 */

export interface PencairanGroup {
  key: string;
  tanggal: string;
  sumber: string;
  items: FinanceChecklistItem[];
  count: number;
  seharusnya: number;
  /** Jumlah yang dicatat masuk (amount_received) dari booking yang sudah dicentang. */
  diterima: number;
  /** Seharusnya dari booking yang belum dicentang. */
  belum: number;
  count_masuk: number;
  count_belum: number;
  /**
   * Tanggal cair hari ini atau nanti: booking yang check-in-nya belum tiba
   * belum ada di daftar, jadi totalnya masih bisa bertambah.
   */
  berjalan: boolean;
}

/** Rentang check-in yang perlu diambil supaya semua booking yang cair di bulan `ym` ikut terbaca. */
export function rentangCheckinUntukPencairan(ym: string, mundurHari = 75): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const awal = new Date(Date.UTC(y, m - 1, 1));
  const akhir = new Date(Date.UTC(y, m, 0));
  const from = new Date(awal.getTime() - mundurHari * 86400000);
  return { from: from.toISOString().slice(0, 10), to: akhir.toISOString().slice(0, 10) };
}

export function kelompokkanPerPencairan(items: FinanceChecklistItem[], ym: string, today: string): PencairanGroup[] {
  const map = new Map<string, PencairanGroup>();
  for (const it of items) {
    const tanggal = it.expected_settlement_date;
    if (!tanggal || tanggal.slice(0, 7) !== ym) continue;
    const sumber = it.sumber ?? "-";
    const key = `${tanggal}|${sumber}`;
    let g = map.get(key);
    if (!g) {
      g = { key, tanggal, sumber, items: [], count: 0, seharusnya: 0, diterima: 0, belum: 0, count_masuk: 0, count_belum: 0, berjalan: tanggal >= today };
      map.set(key, g);
    }
    g.items.push(it);
    g.count++;
    g.seharusnya += it.seharusnya;
    if (it.masuk) {
      g.diterima += it.amount_received ?? 0;
      g.count_masuk++;
    } else {
      g.belum += it.seharusnya;
      g.count_belum++;
    }
  }
  return [...map.values()].sort((a, b) => (a.tanggal === b.tanggal ? a.sumber.localeCompare(b.sumber) : a.tanggal.localeCompare(b.tanggal)));
}
