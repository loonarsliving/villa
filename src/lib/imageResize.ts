"use client";

/**
 * Perkecil foto (KTP/paspor) di browser sebelum diunggah.
 *
 * Alasannya bukan estetika: /api/checkin/upload-ktp adalah Route Handler
 * Next.js di Vercel, dan body request ke sana dibatasi ~4,5MB. Foto kamera
 * HP sekarang biasanya 3–6MB, dan dikirim sebagai data URL base64 yang
 * ukurannya membengkak ~1,37x — jadi satu jepretan KTP bisa menembus batas
 * itu dan check-in gagal dengan galat yang tidak menjelaskan apa pun.
 *
 * Hasil 1600px sisi terpanjang masih jauh lebih dari cukup untuk membaca
 * NIK/nama di KTP, tapi menurunkan ukurannya ke ratusan KB.
 */

export const KTP_MAX_DIMENSION = 1600;
export const KTP_JPEG_QUALITY = 0.82;

/** Batas aman di bawah limit body Vercel (~4,5MB), sudah memperhitungkan base64. */
export const UPLOAD_MAX_DATA_URL_BYTES = 3 * 1024 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Foto tidak bisa dibaca — coba ambil ulang."));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca berkas"));
    reader.readAsDataURL(file);
  });
}

/**
 * Mengembalikan data URL JPEG yang sudah diperkecil. Kalau kanvas tidak
 * tersedia (browser aneh/berkas bukan gambar yang bisa dirender), foto asli
 * dikembalikan apa adanya supaya check-in tidak terblokir — pemanggilnya
 * masih memeriksa ukuran akhir.
 */
export async function shrinkImageForUpload(
  file: File,
  maxDimension: number = KTP_MAX_DIMENSION,
): Promise<string> {
  const original = await readAsDataUrl(file);
  if (!original.startsWith("data:image/")) {
    throw new Error("Berkas yang dipilih bukan gambar.");
  }
  try {
    const img = await loadImage(original);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longest) return original;
    const scale = Math.min(1, maxDimension / longest);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, w, h);
    const shrunk = canvas.toDataURL("image/jpeg", KTP_JPEG_QUALITY);
    // Sebagian foto kecil justru membesar kalau dipaksa jadi JPEG.
    return shrunk.length < original.length ? shrunk : original;
  } catch {
    return original;
  }
}

/** Perkiraan ukuran biner dari sebuah data URL base64. */
export function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
