/** Teks sambutan booking OTA -- disetujui owner 2026-09-28. Fungsi murni, diuji di otaWelcomeText.test.ts. */

export type BahasaSambutan = "id" | "en";

/** Nomor Indonesia (62.../08...) dapat bahasa Indonesia, lainnya bahasa Inggris. */
export function bahasaDariNomor(phone: string): BahasaSambutan {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("62") || d.startsWith("0") ? "id" : "en";
}

/** "MUHAMMAD DAFFA FAUZAN" -> "Muhammad Daffa Fauzan"; nama yang sudah campuran huruf dibiarkan. */
export function rapikanNama(nama: string): string {
  const n = nama.trim().replace(/\s+/g, " ");
  if (!n) return "";
  const semuaBesar = n === n.toUpperCase() && n !== n.toLowerCase();
  const semuaKecil = n === n.toLowerCase() && n !== n.toUpperCase();
  if (!semuaBesar && !semuaKecil) return n;
  return n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

const PLATFORM: Record<string, string> = { agoda: "Agoda", airbnb: "Airbnb" };

/** Tanggal "YYYY-MM-DD" (kalender, bukan waktu) -> "5 Okt" / "5 Oct", dengan tahun opsional. */
function tanggal(iso: string, bahasa: BahasaSambutan, denganTahun: boolean): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(bahasa === "id" ? "id-ID" : "en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(denganTahun ? { year: "numeric" } : {}),
  });
}

export function teksSambutan(p: { nama: string; sumber: string; checkin: string; checkout: string; bahasa: BahasaSambutan }): string {
  const platform = PLATFORM[p.sumber] ?? p.sumber;
  const rentang = `${tanggal(p.checkin, p.bahasa, false)} – ${tanggal(p.checkout, p.bahasa, true)}`;
  if (p.bahasa === "en") {
    return (
      `Hi ${p.nama || "there"} 👋\n\n` +
      `Thank you for choosing Loonars Private Living Yogyakarta for your holiday. ` +
      `We have received your ${platform} booking for ${rentang}.\n\n` +
      `If you have any questions before your arrival, just reply to this message. ` +
      `Our Hospitality Management team is happy to help. See you soon at Loonars! 🌿`
    );
  }
  return (
    `Halo Kak${p.nama ? ` ${p.nama}` : ""} 👋\n\n` +
    `Terima kasih telah memilih Loonars Private Living Yogyakarta sebagai tempat berlibur Kakak. ` +
    `Booking Kakak melalui ${platform} untuk ${rentang} sudah kami terima.\n\n` +
    `Kalau ada pertanyaan sebelum kedatangan, silakan balas pesan ini. ` +
    `Tim Hospitality Management kami siap membantu. Sampai jumpa di Loonars! 🌿`
  );
}
