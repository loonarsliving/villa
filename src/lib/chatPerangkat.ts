/**
 * Status "sudah dilihat" chat tamu PER PERANGKAT (owner 2026-11-12: "jika 1
 * device sudah membuka chat, device lain tidak melihat ada chat yang belum
 * dibalas, baiknya pisahkan per device").
 *
 * `wa_conversations.unread_count` kini berarti "pesan tamu yang belum
 * dibalas" -- tidak lagi dinolkan saat percakapan dibuka, hanya saat staf
 * membalas atau menutup sesi. Jadi semua perangkat tetap melihat chat yang
 * belum dibalas. Perangkat yang sudah membuka percakapan menyimpan
 * `last_message_at` yang ia lihat (localStorage); lencana merah di perangkat
 * itu baru muncul lagi kalau ada pesan yang lebih baru.
 */

export type CatatanDilihat = Record<string, string>;

const KUNCI = "villa_chat_dilihat_v1";
const MAKS = 400;

interface PercakapanRingkas {
  id: string;
  unread_count: number;
  last_message_at: string;
}

function waktu(s: string | undefined | null): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Ada pesan belum dibalas yang BELUM dilihat di perangkat ini. */
export function baruDiPerangkat(c: PercakapanRingkas, dilihat: CatatanDilihat): boolean {
  if (c.unread_count <= 0) return false;
  const lihat = dilihat[c.id];
  return !lihat || waktu(lihat) < waktu(c.last_message_at);
}

/** Jumlah pesan baru di perangkat ini -- untuk lencana menu Chat. */
export function totalBaruDiPerangkat(rows: PercakapanRingkas[], dilihat: CatatanDilihat): number {
  return rows.reduce((s, c) => s + (baruDiPerangkat(c, dilihat) ? c.unread_count : 0), 0);
}

/** Catatan baru setelah percakapan dilihat (murni). Yang terlama dibuang supaya tidak tumbuh tanpa batas. */
export function tandaiDilihat(dilihat: CatatanDilihat, id: string, lastMessageAt: string): CatatanDilihat {
  if (waktu(dilihat[id]) >= waktu(lastMessageAt) && dilihat[id]) return dilihat;
  const baru = { ...dilihat, [id]: lastMessageAt };
  const kunci = Object.keys(baru);
  if (kunci.length <= MAKS) return baru;
  const urut = kunci.sort((a, b) => waktu(baru[b]) - waktu(baru[a])).slice(0, MAKS);
  return Object.fromEntries(urut.map((k) => [k, baru[k]]));
}

export function bacaDilihat(): CatatanDilihat {
  try {
    const isi = JSON.parse(window.localStorage.getItem(KUNCI) ?? "{}");
    return isi && typeof isi === "object" ? (isi as CatatanDilihat) : {};
  } catch {
    return {};
  }
}

export function simpanDilihat(dilihat: CatatanDilihat): void {
  try {
    window.localStorage.setItem(KUNCI, JSON.stringify(dilihat));
    // Lencana menu di halaman yang sama ikut diperbarui tanpa menunggu poll.
    window.dispatchEvent(new Event("villa-chat-dilihat"));
  } catch {
    // Mode privat / penyimpanan diblokir: perangkat ini memakai angka belum-dibalas apa adanya.
  }
}
