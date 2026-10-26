/**
 * Pengajuan biaya manager → Finance (owner 2026-10-26). Data dari villa-api
 * /manager/pengajuan dan /finance/pengajuan; tabel villa_pengajuan_biaya.
 * Kategori "lain_lain" memakai nama yang ditulis manager sendiri.
 */

export type KategoriPengajuan = "laundry" | "netflix" | "lain_lain";
export type JenisPengajuan = "permintaan_dana" | "reimburse";
export type StatusPengajuan = "diajukan" | "disetujui" | "ditolak" | "ditransfer" | "dibatalkan";

export interface RiwayatPengajuan {
  status: StatusPengajuan;
  oleh_nama: string | null;
  catatan: string | null;
  created_at: string;
}

export interface PengajuanBiaya {
  id: string;
  nomor: number;
  kategori: KategoriPengajuan;
  kategori_nama: string | null;
  jenis: JenisPengajuan;
  periode: string;
  nominal: number;
  keterangan: string;
  penerima_nama: string | null;
  penerima_bank: string | null;
  penerima_rekening: string | null;
  status: StatusPengajuan;
  diajukan_lewat: "dashboard" | "chat";
  diajukan_oleh_nama: string;
  diputus_oleh_nama: string | null;
  diputus_at: string | null;
  catatan_finance: string | null;
  alasan_tolak: string | null;
  tanggal_transfer: string | null;
  ditransfer_oleh_nama: string | null;
  ditransfer_at: string | null;
  alasan_batal: string | null;
  created_at: string;
  nota_url: string | null;
  bukti_bayar_url: string | null;
  bukti_transfer_url: string | null;
  riwayat: RiwayatPengajuan[];
}

export const LABEL_KATEGORI: Record<KategoriPengajuan, string> = {
  laundry: "Laundry",
  netflix: "Netflix",
  lain_lain: "Lain-lain",
};

export const LABEL_JENIS: Record<JenisPengajuan, string> = {
  permintaan_dana: "Permintaan dana",
  reimburse: "Reimburse (sudah dibayar sendiri)",
};

export const LABEL_STATUS: Record<StatusPengajuan, string> = {
  diajukan: "Menunggu Finance",
  disetujui: "Disetujui, menunggu transfer",
  ditolak: "Ditolak",
  ditransfer: "Sudah ditransfer",
  dibatalkan: "Dibatalkan",
};

export const NADA_STATUS: Record<StatusPengajuan, "ok" | "pending" | "danger"> = {
  diajukan: "pending",
  disetujui: "pending",
  ditolak: "danger",
  ditransfer: "ok",
  dibatalkan: "danger",
};

/** Nama biaya di layar: "Laundry", "Netflix", atau nama tulisan manager untuk lain-lain. */
export function namaBiaya(p: Pick<PengajuanBiaya, "kategori" | "kategori_nama">): string {
  return p.kategori === "lain_lain" && p.kategori_nama ? p.kategori_nama : LABEL_KATEGORI[p.kategori];
}

export function kodePengajuan(nomor: number): string {
  return `PB-${String(nomor).padStart(4, "0")}`;
}

export interface RekapPeriode {
  periode: string;
  ditransfer: number;
  menunggu: number;
  perBiaya: { nama: string; ditransfer: number; menunggu: number }[];
}

/**
 * Rekap per bulan biaya: total yang sudah ditransfer, dan yang masih
 * menunggu (diajukan/disetujui). Ditolak/dibatalkan tidak dihitung.
 * Terbaru di atas; per biaya diurutkan dari yang terbesar.
 */
export function rekapPerPeriode(list: PengajuanBiaya[]): RekapPeriode[] {
  const per = new Map<string, Map<string, { ditransfer: number; menunggu: number }>>();
  for (const p of list) {
    if (p.status === "ditolak" || p.status === "dibatalkan") continue;
    const biaya = per.get(p.periode) ?? new Map();
    const nama = namaBiaya(p);
    const cur = biaya.get(nama) ?? { ditransfer: 0, menunggu: 0 };
    if (p.status === "ditransfer") cur.ditransfer += Number(p.nominal);
    else cur.menunggu += Number(p.nominal);
    biaya.set(nama, cur);
    per.set(p.periode, biaya);
  }
  return [...per.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([periode, biaya]) => {
      const perBiaya = [...biaya.entries()]
        .map(([nama, v]) => ({ nama, ...v }))
        .sort((a, b) => b.ditransfer + b.menunggu - (a.ditransfer + a.menunggu) || a.nama.localeCompare(b.nama));
      return {
        periode,
        ditransfer: perBiaya.reduce((s, b) => s + b.ditransfer, 0),
        menunggu: perBiaya.reduce((s, b) => s + b.menunggu, 0),
        perBiaya,
      };
    });
}

/** "2026-11" → "November 2026". */
export function labelPeriode(periode: string): string {
  const [y, m] = periode.split("-").map(Number);
  if (!y || !m) return periode;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Angka dari kolom nominal yang diketik ("350.000", "Rp 350000") → 350000, atau null. */
export function bacaNominal(teks: string): number | null {
  const angka = teks.replace(/[^0-9]/g, "");
  if (!angka) return null;
  const n = Number(angka);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
