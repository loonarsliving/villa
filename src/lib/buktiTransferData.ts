/**
 * Mesin bukti transfer dividen (owner 2026-10-25): owner mencentang investor
 * yang sudah ditransfer di /admin/bukti-transfer, mesin membuat bukti versi
 * Loonars per investor lalu mengirimnya lewat WA nomor utama.
 *
 * Modul ini murni (tanpa I/O) supaya angka dan pengelompokannya bisa diuji:
 *  - satu bukti per NOMOR HP, bukan per akun -- investor yang memegang dua
 *    unit lewat dua akun (mis. A5 + C3) menerima satu bukti gabungan;
 *  - jumlah per unit = bagi hasil + top-up jaminan dari computeReport
 *    villa-api (= jaminan minimal bila bagi hasil di bawahnya), atau angka
 *    pemasukan tetap untuk akun berkontrak khusus;
 *  - komisi OTA TIDAK PERNAH ditampilkan (owner 2026-10-25): pendapatan villa
 *    yang dipakai adalah angka setelah komisi.
 */

/** Batas OPEX yang dijanjikan ke investor; kelebihannya ditanggung Loonars (owner 2026-10-25). */
export const TARGET_OPEX_PCT = 25;

export interface InvestorAkun {
  id: string;
  nama: string;
  hp: string | null;
  unit_nomor: string | null;
  bank_nama: string | null;
  no_rekening: string | null;
  nama_pemilik_rekening: string | null;
  /** Unit di villa_investor_units milik akun ini. Kosong = dianggap 1 unit. */
  units: string[];
  /** Angka pemasukan tetap yang berlaku periode ini, null kalau tidak ada. */
  pemasukan_tetap: number | null;
}

export interface PenerimaBukti {
  /** Nomor HP (digit saja) -- kunci pengiriman dan pencatatan. */
  kunci: string;
  hp: string;
  nama: string;
  bank: string | null;
  rek4: string | null;
  units: string[];
  jumlah: number;
  pemasukan_tetap: boolean;
  rekening_lengkap: boolean;
}

export interface LaporanBulan {
  revenue: number;
  malam_terisi: number;
  cogs: number;
  cogs_per_malam: number;
  opex: number;
  opex_rincian: { peran: string; orang: number }[];
  per_investor_amount: number;
  jaminan_topup: number;
}

export interface RingkasanVilla {
  pendapatan: number;
  malam_terisi: number;
  biaya_per_malam: number;
  cogs_per_malam: number;
  gaji: number;
  staf: string;
  staf_orang: number;
  opex_total: number;
  opex_pct: number;
  target_opex: number;
  kelebihan_opex: number;
}

export function digitHp(hp: string | null | undefined): string {
  return String(hp ?? "").replace(/\D/g, "");
}

/** Bagian satu unit bulan ini: bagi hasil, atau jaminan minimal bila bagi hasil di bawahnya. */
export function jumlahPerUnit(lap: Pick<LaporanBulan, "per_investor_amount" | "jaminan_topup">): number {
  return Math.round(lap.per_investor_amount + lap.jaminan_topup);
}

export function kelompokkanPenerima(akun: InvestorAkun[], perUnit: number): PenerimaBukti[] {
  const peta = new Map<string, PenerimaBukti>();
  for (const a of akun) {
    const hp = digitHp(a.hp);
    if (hp.length < 8) continue;
    const units = a.units.length ? a.units : a.unit_nomor ? [a.unit_nomor] : [];
    const tetap = a.pemasukan_tetap != null;
    const jumlah = tetap ? Math.round(a.pemasukan_tetap as number) : perUnit * Math.max(1, units.length);
    const nama = (a.nama_pemilik_rekening || a.nama || "").trim();
    const bank = a.bank_nama?.trim() || null;
    const rek = digitHp(a.no_rekening);
    const ada = peta.get(hp);
    if (ada) {
      ada.units.push(...units.filter((u) => !ada.units.includes(u)));
      ada.jumlah += jumlah;
      ada.pemasukan_tetap = ada.pemasukan_tetap || tetap;
      if (!ada.rekening_lengkap && bank && rek) {
        ada.bank = bank;
        ada.rek4 = rek.slice(-4);
        ada.rekening_lengkap = true;
      }
      continue;
    }
    peta.set(hp, {
      kunci: hp,
      hp,
      nama,
      bank,
      rek4: rek ? rek.slice(-4) : null,
      units: tetap ? [] : [...units],
      jumlah,
      pemasukan_tetap: tetap,
      rekening_lengkap: !!(bank && rek),
    });
  }
  return [...peta.values()].sort((x, y) => (x.units[0] ?? "~").localeCompare(y.units[0] ?? "~"));
}

export function hitungRingkasan(lap: LaporanBulan): RingkasanVilla {
  const pendapatan = Math.round(lap.revenue);
  const biaya_per_malam = Math.round(lap.cogs);
  const gaji = Math.round(lap.opex);
  const opex_total = biaya_per_malam + gaji;
  const target_opex = Math.round((pendapatan * TARGET_OPEX_PCT) / 100);
  const staf_orang = lap.opex_rincian.reduce((s, p) => s + p.orang, 0);
  return {
    pendapatan,
    malam_terisi: lap.malam_terisi,
    biaya_per_malam,
    cogs_per_malam: Math.round(lap.cogs_per_malam),
    gaji,
    staf: lap.opex_rincian.map((p) => `${p.orang} ${p.peran.toLowerCase()}`).join(", "),
    staf_orang,
    opex_total,
    opex_pct: pendapatan > 0 ? Math.round((opex_total / pendapatan) * 1000) / 10 : 0,
    target_opex,
    kelebihan_opex: Math.max(0, opex_total - target_opex),
  };
}

/** Isi satu gambar bukti. Ikut ditandatangani di URL gambar, jadi harus ringkas. */
export interface IsiBukti {
  v: 1;
  nama: string;
  bank: string | null;
  rek4: string | null;
  units: string[];
  jumlah: number;
  tetap: boolean;
  per_unit: number;
  periode: string; // "YYYY-MM"
  tgl: string; // tanggal transfer, "YYYY-MM-DD" WIB
  hari: number; // data dihitung sampai tanggal ini di bulan periode
  r: RingkasanVilla;
  exp: number; // epoch detik
}

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export function namaBulan(periode: string): string {
  const [y, m] = periode.split("-").map(Number);
  return `${BULAN[m - 1]} ${y}`;
}

export function tanggalPanjang(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}

export function rupiah(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

export function nomorBukti(isi: Pick<IsiBukti, "periode" | "units" | "tetap">): string {
  const yymm = isi.periode.slice(2, 4) + isi.periode.slice(5, 7);
  return `LNR/BH/${yymm}/${isi.tetap || !isi.units.length ? "TETAP" : isi.units.join("-")}`;
}

/** Keterangan WA yang menyertai gambar -- nada sama dengan /bridge/dividend-proof-forward villa-api. */
export function teksPengantar(nama: string, periode: string): string {
  return `Assalamu'alaikum/Salam sejahtera, Bapak/Ibu ${nama}.\n\nDengan penuh rasa syukur, kami sampaikan bahwa dividen Anda dari Loonars Private Living 1 periode ${namaBulan(periode)} telah kami transfer ke rekening Anda. Bukti transfer terlampir.\n\nTerima kasih atas kepercayaan Bapak/Ibu berinvestasi bersama kami. Semoga kerja sama ini terus membawa berkah untuk kita semua.\n\nSalam hangat,\nLoonars Private Living 1`;
}
