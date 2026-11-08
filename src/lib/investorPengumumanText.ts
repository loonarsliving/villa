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
  teks: (nama: string) => string;
}

export const PENGUMUMAN: Pengumuman = {
  id: "investor_pengumuman_20261108",
  berlakuSampai: "2026-11-09",
  teks: (nama) =>
    [
      "*Pengumuman untuk Investor Loonars Private Living*",
      "",
      `Yth. Bapak/Ibu *${nama}*,`,
      "",
      "Dengan penuh syukur kami mengabarkan bahwa *Loonars Excellent Living resmi dibuka pada Kamis, 12 November 2026.*",
      "",
      "Kami juga memohon maaf karena *grand opening Loonars Private Living belum terealisasi* hingga saat ini. Kami berencana mengadakan grand opening Loonars Private Living *bersamaan dengan pembukaan Loonars Coffee*, yang dijadwalkan pada *awal Desember 2026*. Undangan dan detail acaranya akan kami sampaikan kemudian.",
      "",
      "Sebagai ucapan terima kasih atas kepercayaan Bapak/Ibu, kini tersedia fasilitas *Priority Investor Loonars* berupa *diskon 20% untuk semua produk Loonars*: Loonars Excellent Living, Loonars Coffee, dan Loonars Beauty.",
      "",
      "🏡 *Loonars Excellent Living*",
      "Buka menu *Kupon Diskon 20%* di Dashboard Investor. Tersedia 5 kode yang bisa Bapak/Ibu pakai sendiri atau bagikan ke keluarga, teman, dan relasi. Masukkan kode di kolom *Kode referral* saat memesan di loonars.id. Setiap kode yang terpakai otomatis diganti kode baru.",
      "",
      "☕ *Loonars Coffee* & ✨ *Loonars Beauty*",
      "Buka menu *Kartu Priority* di Dashboard Investor, lalu tunjukkan kartu langsung dari layar HP ke kasir.",
      "",
      "Dashboard Investor: https://living.haluoleo.id",
      "",
      "Loonars tidak akan ada tanpa Bapak/Ibu. Sejauh apa pun Loonars berkembang, selama itu pula Bapak/Ibu akan selalu menjadi prioritas kami. 🙏",
      "",
      "Hormat kami,",
      "*Manajemen Loonars*",
    ].join("\n"),
};

export interface InvestorWa {
  nama: string | null;
  hp: string | null;
}

/**
 * Satu penerima per nomor (investor multi-akun memakai nama akun pertama
 * sesuai urutan masukan). Nomor < 8 digit dihitung tanpa_nomor.
 */
export function penerimaPengumuman(investor: InvestorWa[]): { penerima: { hp: string; nama: string }[]; tanpaNomor: number } {
  const peta = new Map<string, string>();
  let tanpaNomor = 0;
  for (const inv of investor) {
    const hp = String(inv.hp ?? "").replace(/\D/g, "");
    if (hp.length < 8) {
      tanpaNomor++;
      continue;
    }
    if (!peta.has(hp)) peta.set(hp, String(inv.nama ?? "").trim() || "Investor Loonars");
  }
  return { penerima: [...peta].map(([hp, nama]) => ({ hp, nama })), tanpaNomor };
}
