/** Batas ukuran gambar chat setelah dikecilkan di browser (body permintaan Vercel maks ~4,5MB). */
export const MAKS_BYTE_GAMBAR_CHAT = 3 * 1024 * 1024;

const JENIS: Record<string, { ext: string; contentType: string }> = {
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
  jpg: { ext: "jpg", contentType: "image/jpeg" },
  png: { ext: "png", contentType: "image/png" },
  webp: { ext: "webp", contentType: "image/webp" },
};

/** Membaca data URL gambar dari halaman Chat: hanya JPEG/PNG/WebP, dan tidak lebih dari batas ukuran. */
export function bacaGambarDataUrl(
  dataUrl: string,
): { bytes: Buffer; ext: string; contentType: string } | { error: string } {
  const match = /^data:image\/([a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  const jenis = match ? JENIS[match[1]] : undefined;
  if (!match || !jenis) return { error: "Format gambar tidak didukung (pakai JPG, PNG, atau WebP)" };
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) return { error: "Gambar kosong" };
  if (bytes.length > MAKS_BYTE_GAMBAR_CHAT) return { error: "Gambar terlalu besar (maks 3MB)" };
  return { bytes, ...jenis };
}

/** Domain produksi villa -- WhaCenter harus bisa mengunduh dari sini (tautan pratinjau Vercel diproteksi). */
const ASAL_PUBLIK = "https://living.haluoleo.id";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");
const FILE_RE = new RegExp(`^${UUID}\\.(jpg|png|webp)$`, "i");

export const JENIS_PER_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Tautan pendek tanpa query untuk gambar chat (lihat src/lib/chatGambar.ts). */
export function tautanGambarChat(conversationId: string, file: string): string {
  return `${ASAL_PUBLIK}/api/chat/gambar/${conversationId}/${file}`;
}

/** Bagian tautan yang sah: id percakapan UUID + nama file "<uuid>.jpg|png|webp" -- tidak ada "/" atau "..". */
export function bagianGambarChatSah(conversationId: string, file: string): boolean {
  return UUID_RE.test(conversationId) && FILE_RE.test(file);
}
