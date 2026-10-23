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
