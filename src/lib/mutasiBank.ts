import type { PencairanGroup } from "@/lib/financePencairan";

/**
 * Pencocokan mutasi bank dengan pencairan OTA (owner 2026-10-29: "apa
 * baiknya ada fitur untuk mengirim mutasi bank, agar bisa dicocokkan dengan
 * mudah ... bentuk foto saja juga tidak masalah").
 *
 * AI (lewat jembatan Mkhsistem) hanya MENYALIN baris mutasi. Mencocokkan
 * transfer dengan pencairan dikerjakan di sini dengan aturan tetap, dan
 * hasilnya hanya usulan: finance yang menekan tombol untuk mencatatnya.
 */

export interface MutasiBaris {
  tanggal: string;
  keterangan: string;
  nominal: number;
  arah: "masuk" | "keluar";
}

export type StatusCocok = "cocok" | "selisih" | "sudah_tercatat" | "tidak_ketemu";

export interface HasilCocok {
  baris: MutasiBaris;
  /** Channel yang dikenali dari keterangan transfer, null kalau tidak ada nama OTA. */
  sumber: string | null;
  group: PencairanGroup | null;
  status: StatusCocok;
  /** Nominal mutasi - angka yang belum masuk di pencairan itu. */
  selisih: number | null;
}

/**
 * Nama pengirim di keterangan transfer. Traveloka mentransfer atas nama
 * badan usahanya, PT Trinusa Travelindo. Belum dicocokkan dengan mutasi
 * Mandiri yang sebenarnya -- kalau ada OTA yang tidak dikenali, tambahkan
 * polanya di sini.
 */
const POLA_SUMBER: { sumber: string; pola: RegExp }[] = [
  { sumber: "booking.com", pola: /booking/ },
  { sumber: "agoda", pola: /agoda/ },
  { sumber: "traveloka", pola: /traveloka|trinusa/ },
  { sumber: "airbnb", pola: /airbnb/ },
];

export function kenaliSumber(keterangan: string): string | null {
  const teks = keterangan.toLowerCase();
  for (const { sumber, pola } of POLA_SUMBER) if (pola.test(teks)) return sumber;
  return null;
}

/** Transfer bisa tiba beberapa hari sebelum/sesudah tanggal cair perkiraan. */
export const MAKS_JARAK_HARI = 7;
/** Komisi OTA per booking bervariasi; di atas ini dianggap bukan transfer yang sama. */
export const MAKS_SELISIH_OTA = 0.15;
/** Tanpa nama OTA di keterangan, hanya nominal yang nyaris sama persis yang diusulkan. */
export const MAKS_SELISIH_TANPA_NAMA = 0.02;
/** Di bawah ini (relatif) selisih dianggap pembulatan, bukan beda komisi. */
const BATAS_COCOK = 0.005;

function jarakHari(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
}

/** Angka pembanding: yang belum masuk, atau seluruhnya kalau sudah lengkap. */
function targetGroup(g: PencairanGroup): number {
  return g.count_belum > 0 ? g.belum : g.seharusnya;
}

/**
 * Setiap uang masuk dipasangkan ke paling banyak satu pencairan, dan setiap
 * pencairan ke paling banyak satu uang masuk -- pasangan terdekat (tanggal
 * lalu nominal) dipilih lebih dulu, supaya dua transfer Booking.com mingguan
 * dengan nilai mirip tidak berebut pencairan yang sama.
 */
export function cocokkanMutasi(baris: MutasiBaris[], groups: PencairanGroup[]): HasilCocok[] {
  const masuk = baris.filter((b) => b.arah === "masuk");
  const sumberPer = masuk.map((b) => kenaliSumber(b.keterangan));

  const kandidat: { i: number; g: PencairanGroup; skor: number }[] = [];
  masuk.forEach((b, i) => {
    const sumber = sumberPer[i];
    for (const g of groups) {
      if (sumber && g.sumber !== sumber) continue;
      const jarak = jarakHari(b.tanggal, g.tanggal);
      if (jarak > MAKS_JARAK_HARI) continue;
      const target = targetGroup(g);
      if (target <= 0) continue;
      const rasio = Math.abs(b.nominal - target) / target;
      if (rasio > (sumber ? MAKS_SELISIH_OTA : MAKS_SELISIH_TANPA_NAMA)) continue;
      // 1% selisih nominal ~ setara 1 hari jarak tanggal.
      kandidat.push({ i, g, skor: jarak + rasio * 100 });
    }
  });
  kandidat.sort((a, b) => a.skor - b.skor);

  const pasangan = new Map<number, PencairanGroup>();
  const groupTerpakai = new Set<string>();
  for (const k of kandidat) {
    if (pasangan.has(k.i) || groupTerpakai.has(k.g.key)) continue;
    pasangan.set(k.i, k.g);
    groupTerpakai.add(k.g.key);
  }

  return masuk.map((b, i) => {
    const g = pasangan.get(i) ?? null;
    const sumber = sumberPer[i] ?? g?.sumber ?? null;
    if (!g) return { baris: b, sumber, group: null, status: "tidak_ketemu", selisih: null };
    if (g.count_belum === 0) return { baris: b, sumber, group: g, status: "sudah_tercatat", selisih: b.nominal - g.seharusnya };
    const selisih = b.nominal - g.belum;
    const status: StatusCocok = Math.abs(selisih) <= g.belum * BATAS_COCOK ? "cocok" : "selisih";
    return { baris: b, sumber, group: g, status, selisih };
  });
}
