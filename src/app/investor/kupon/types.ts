/** Jawaban villa-api GET /investor/kupon (owner 2026-11-08). */
export type JawabanKupon = {
  persen: number;
  tautan_pemesanan: string;
  tersedia: { kode: string; persen: number }[];
  riwayat: {
    kode: string;
    properti: string;
    tgl_checkin: string | null;
    tgl_checkout: string | null;
    status: "lunas" | "menunggu_pembayaran" | "batal";
    diskon: number;
    dipakai_pada: string | null;
  }[];
  aturan: string;
  kartu: {
    nama: string | null;
    no_anggota: string;
    sejak: string | null;
    persen: number;
    berlaku_di: string[];
  };
};

/** Tautan pemesanan EL dengan kode referral sudah terisi di form. */
export function tautanDenganKode(tautan: string, kode: string): string {
  return `${tautan}?ref=${encodeURIComponent(kode)}#menginap`;
}

export function pesanBagikan(tautan: string, kode: string, persen: number): string {
  return (
    `Halo! Ada kode diskon ${persen}% untuk menginap di Loonars Excellent Living, Yogyakarta.\n\n` +
    `Kode referral: ${kode}\n` +
    `Pesan di sini (kode sudah terisi): ${tautanDenganKode(tautan, kode)}\n\n` +
    `Satu kode untuk satu pemesanan.`
  );
}
