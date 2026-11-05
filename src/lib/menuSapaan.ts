/**
 * Menu sapaan otomatis untuk chat pembuka yang isinya HANYA salam ("Halo kak",
 * "Malam kak", "Permisi kak") dari nomor yang belum pernah chat ke 0822
 * (permintaan owner 2026-11-05).
 *
 * Latar belakang: audit ai_conversations 23 Okt - 5 Nov menunjukkan banyak tamu
 * membuka dengan salam saja. Salam tidak bisa dibedakan dari chat bisnis lain
 * di nomor yang sama, jadi tidak masuk Chat resepsionis -- dan Mkhsistem juga
 * diam (ai_lead_manual_takeover aktif), sehingga tamu tidak dibalas siapa pun.
 * Menu ini menanyakan keperluannya; baru jawaban "1" (atau pertanyaan menginap
 * yang dikenali menyebutSewaVilla) yang membuka percakapan di resepsionis.
 *
 * Berkas ini murni (tanpa I/O) supaya bisa dites. Keputusan siapa yang boleh
 * menerima menu ada di waChat.ts (bolehDapatMenuSapaan / menuSapaanTertunda).
 */

/** Kata yang boleh ada di pesan "salam saja". Sengaja tanpa pak/bu: itu lebih sering rekan bisnis. */
const KATA_SALAM =
  /^(h+a+l+o+|h+e+l+o+|ha+i+|ha+y+|hi+|hey+|permisi|misi|punten|selamat|slmt|met|pagi|siang|sore|malam|mlm|petang|kak|ka|kk|kakak|kaka|kakk|min|admin|mimin|minn|assalamualaikum|assalamu|alaikum|asalamualaikum|assalamualaikom|wr|wb|salam|p|ping|guys)$/i;

/** true kalau pesan hanya berisi salam (tanpa pertanyaan apa pun). */
export function hanyaSapaan(teks: string): boolean {
  const kata = teks
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (!kata.length || kata.length > 6) return false;
  return kata.every((k) => KATA_SALAM.test(k));
}

export type PilihanMenu = "menginap" | "properti" | "lainnya";

/** Jawaban angka atas menu: "1", "1.", "1 kak", "no 1", "satu". null = bukan jawaban menu. */
export function bacaPilihanMenu(teks: string): PilihanMenu | null {
  const t = teks.trim().toLowerCase().replace(/[.)!?,\s]+$/g, "").replace(/\s+(kak|ka|kk|min)$/, "");
  const m = t.match(/^(?:no\.?\s*|nomor\s*|pilih\s*)?([1-3]|satu|dua|tiga)$/);
  if (!m) return null;
  const n = { satu: "1", dua: "2", tiga: "3" }[m[1] as "satu" | "dua" | "tiga"] ?? m[1];
  return n === "1" ? "menginap" : n === "2" ? "properti" : "lainnya";
}

export function teksMenuSapaan(namaTampilan?: string | null): string {
  const nama = (namaTampilan ?? "").trim();
  const sapa = nama && nama.length <= 40 ? `Halo Kak ${nama},` : "Halo Kak,";
  return (
    `${sapa} terima kasih sudah menghubungi kami 🙏\n` +
    "Ada yang bisa kami bantu? Silakan balas dengan angka:\n\n" +
    "1. Menginap / booking di Loonars Private Living Yogyakarta\n" +
    "2. Properti & investasi\n" +
    "3. Lainnya\n\n" +
    "Atau langsung tuliskan pertanyaan Kakak ya."
  );
}

/** Balasan untuk pilihan 2/3 -- tidak masuk resepsionis, ditangani tim seperti biasa. */
export const TEKS_PILIHAN_LAIN = "Baik Kak, terima kasih. Pesan Kakak sudah kami terima dan tim kami akan segera membalas 🙏";

/** Isi yang dicatat di Chat resepsionis saat tamu menjawab "1", supaya resepsionis tahu artinya. */
export function isiPilihanMenginap(teksAsli: string): string {
  return `${teksAsli.trim()} (pilihan menu sapaan: Menginap / booking)`;
}
