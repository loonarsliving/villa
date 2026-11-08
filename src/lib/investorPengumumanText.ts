/**
 * Teks pengumuman WhatsApp sekali kirim ke investor Private Living.
 * Disetujui owner 2026-11-08 (pembukaan Excellent Living, permintaan maaf
 * grand opening PL, fasilitas Priority Investor). Pengumuman berikutnya =
 * PENGUMUMAN baru dengan id baru, hanya atas permintaan owner.
 */

export interface Pengumuman {
  /** Dipakai sebagai template_type di wa_messages_log; satu nomor menerima satu id sekali saja. */
  id: string;
  /** Hari terakhir (WIB, YYYY-MM-DD) pengumuman boleh dikirim; sesudahnya rute tidak mengirim apa pun. */
  berlakuSampai: string;
  /** Nama akun (persis, tanpa beda huruf besar/kecil) yang tidak dikirimi pengumuman ini. */
  lewati: string[];
  teks: (nama: string) => string;
  /** Versi untuk penerima tambahan tanpa akses dashboard (lihat investorPenerimaTambahan.ts). */
  teksTanpaAkses: (nama: string) => string;
}

const bagianAwal = (nama: string) => [
  "*Pengumuman untuk Investor Loonars Private Living*",
  "",
  `Yth. Bapak/Ibu *${nama}*,`,
  "",
  "Dengan penuh syukur kami mengabarkan bahwa *Loonars Excellent Living resmi dibuka pada Kamis, 12 November 2026.*",
  "",
  "Kami juga memohon maaf karena *grand opening Loonars Private Living belum terealisasi* hingga saat ini. Kami berencana mengadakan grand opening Loonars Private Living *bersamaan dengan pembukaan Loonars Coffee*, yang dijadwalkan pada *awal Desember 2026*. Undangan dan detail acaranya akan kami sampaikan kemudian.",
  "",
];
const bagianAkhir = [
  "",
  "Loonars tidak akan ada tanpa Bapak/Ibu. Sejauh apa pun Loonars berkembang, selama itu pula Bapak/Ibu akan selalu menjadi prioritas kami. 🙏",
  "",
  "Hormat kami,",
  "*Manajemen Loonars*",
];

export const PENGUMUMAN: Pengumuman = {
  id: "investor_pengumuman_20261108",
  berlakuSampai: "2026-11-09",
  // Sempat ["Investor A1"] (owner 2026-11-08). Ternyata investor sungguhan
  // (rekening a.n. MUSAFA); nama akun diganti "Musafa" atas persetujuan owner
  // dan pengumuman dikirim kepadanya. Tidak ada lagi yang dilewati.
  lewati: [],
  teks: (nama) =>
    [
      ...bagianAwal(nama),
      "Sebagai ucapan terima kasih atas kepercayaan Bapak/Ibu, kini tersedia fasilitas *Priority Investor Loonars* berupa *diskon 20% untuk semua produk Loonars*: Loonars Excellent Living, Loonars Coffee, dan Loonars Beauty.",
      "",
      "🏡 *Loonars Excellent Living*",
      "Buka menu *Kupon Diskon 20%* di Dashboard Investor. Tersedia 5 kode yang bisa Bapak/Ibu pakai sendiri atau bagikan ke keluarga, teman, dan relasi. Masukkan kode di kolom *Kode referral* saat memesan di loonars.id. Setiap kode yang terpakai otomatis diganti kode baru.",
      "",
      "☕ *Loonars Coffee* & ✨ *Loonars Beauty*",
      "Buka menu *Kartu Priority* di Dashboard Investor, lalu tunjukkan kartu langsung dari layar HP ke kasir.",
      "",
      "Dashboard Investor: https://living.haluoleo.id",
      ...bagianAkhir,
    ].join("\n"),
  // Owner 2026-11-08: untuk penerima tambahan, fasilitas aktif "stlah anda
  // sdh memiliki akses ke sistem loonars" (bukan "setelah pelunasan").
  teksTanpaAkses: (nama) =>
    [
      ...bagianAwal(nama),
      "Sebagai ucapan terima kasih atas kepercayaan Bapak/Ibu, Loonars menghadirkan fasilitas *Priority Investor Loonars* berupa *diskon 20% untuk semua produk Loonars*: Loonars Excellent Living, Loonars Coffee, dan Loonars Beauty.",
      "",
      "Fasilitas ini berupa kupon diskon yang bisa Bapak/Ibu pakai sendiri atau bagikan ke keluarga, teman, dan relasi, serta Kartu Priority Investor yang cukup ditunjukkan ke kasir. Semuanya dapat Bapak/Ibu nikmati *setelah Bapak/Ibu memiliki akses ke sistem Loonars*.",
      ...bagianAkhir,
    ].join("\n"),
};

export interface InvestorWa {
  nama: string | null;
  hp: string | null;
}

/**
 * Nama untuk sapaan (owner 2026-11-08: "rapikan namanya"): huruf besar di
 * awal tiap kata, sisanya kecil; titik yang menempel diberi spasi
 * ("IR.AGUSTAM" -> "Ir. Agustam").
 */
export function rapikanNama(nama: string): string {
  return nama
    .replace(/\.(?=\S)/g, ". ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((k) => k.charAt(0).toLocaleUpperCase("id-ID") + k.slice(1).toLocaleLowerCase("id-ID"))
    .join(" ");
}

/**
 * Satu penerima per nomor (investor multi-akun memakai nama akun pertama
 * sesuai urutan masukan). Nomor < 8 digit dihitung tanpa_nomor.
 */
export function penerimaPengumuman(
  investor: InvestorWa[],
  lewati: string[] = [],
): { penerima: { hp: string; nama: string }[]; tanpaNomor: number; dilewati: number } {
  const peta = new Map<string, string>();
  const dilewatiSet = new Set(lewati.map((n) => n.trim().toLowerCase()));
  let tanpaNomor = 0;
  let dilewati = 0;
  for (const inv of investor) {
    if (dilewatiSet.has(String(inv.nama ?? "").trim().toLowerCase())) {
      dilewati++;
      continue;
    }
    const hp = String(inv.hp ?? "").replace(/\D/g, "");
    if (hp.length < 8) {
      tanpaNomor++;
      continue;
    }
    if (!peta.has(hp)) peta.set(hp, rapikanNama(String(inv.nama ?? "")) || "Investor Loonars");
  }
  return { penerima: [...peta].map(([hp, nama]) => ({ hp, nama })), tanpaNomor, dilewati };
}
