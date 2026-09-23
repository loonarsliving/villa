const VILLA_API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

/** Batas tunggu: villa-api yang menggantung tidak boleh ikut menggantungkan check-in. */
const TIMEOUT_MS = 10_000;

/**
 * Tiga keadaan, bukan dua. Membedakan "sesinya memang ditolak" dari "sesinya
 * tidak bisa diperiksa sekarang" itu penting karena `src/lib/api.ts`
 * MENGELUARKAN pengguna dari aplikasi setiap kali menerima 401
 * (`endSession()`).
 *
 * Kalau gangguan jaringan sesaat dipetakan jadi 401, resepsionis akan
 * terlempar ke halaman login di tengah check-in — dengan tamu berdiri di
 * meja depan, foto KTP sudah diambil, dan tanda tangan sudah dibubuhkan.
 * Gangguan seperti itu harus jadi 503: "coba lagi", bukan "sesi Anda habis".
 */
export type HasilPeriksaToken = "lolos" | "ditolak" | "gagal-periksa";

async function periksaToken(token: string, path: string): Promise<HasilPeriksaToken> {
  let res: Response;
  try {
    res = await fetch(`${VILLA_API_BASE}${path}`, {
      headers: { "x-villa-token": token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Jaringan putus, DNS gagal, atau kehabisan waktu. Sebelumnya ini
    // melempar keluar dari rute dan berubah jadi 500 yang tidak menjelaskan
    // apa pun.
    return "gagal-periksa";
  }
  if (res.ok) return "lolos";
  // villa-api sendiri yang sedang bermasalah (5xx, atau 502/504 dari
  // gateway) bukan berarti sesinya mati.
  if (res.status >= 500) return "gagal-periksa";
  return "ditolak";
}

/** Admin saja — lewat endpoint villa-api yang memang khusus admin. */
export function periksaTokenAdmin(token: string): Promise<HasilPeriksaToken> {
  return periksaToken(token, "/admin/overview");
}

/** Admin ATAU resepsionis — lewat endpoint villa-api yang khusus staf. */
export function periksaTokenStaf(token: string): Promise<HasilPeriksaToken> {
  return periksaToken(token, "/summary");
}

/**
 * Bentuk boolean yang lama, dipertahankan untuk rute admin yang belum
 * dipindahkan. Sengaja MELEMPAR saat gagal diperiksa (bukan mengembalikan
 * false), supaya gangguan jaringan tidak berubah jadi 401 yang mengeluarkan
 * pengguna dari aplikasi. Rute baru sebaiknya memakai periksaToken* di atas.
 */
async function tokenPasses(token: string, path: string): Promise<boolean> {
  const hasil = await periksaToken(token, path);
  if (hasil === "gagal-periksa") throw new Error("villa-api tidak bisa dihubungi untuk memeriksa sesi");
  return hasil === "lolos";
}

/** Confirms an x-villa-token belongs to an admin session, by forwarding it to villa-api's own admin-only /admin/overview. */
export async function isAdminToken(token: string): Promise<boolean> {
  return tokenPasses(token, "/admin/overview");
}

/** Confirms an x-villa-token belongs to an admin OR receptionist session, by forwarding it to villa-api's own staff-only /summary. */
export async function isStaffToken(token: string): Promise<boolean> {
  return tokenPasses(token, "/summary");
}
