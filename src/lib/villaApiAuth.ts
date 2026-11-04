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

/** Manager ATAU admin — lewat endpoint villa-api yang khusus modul manager. */
export function periksaTokenManager(token: string): Promise<HasilPeriksaToken> {
  return periksaToken(token, "/manager/whoami");
}

/** Finance ATAU admin — lewat endpoint villa-api yang khusus Finance. */
export function periksaTokenFinance(token: string): Promise<HasilPeriksaToken> {
  return periksaToken(token, "/finance/whoami");
}

/** Resepsionis/investor EL, finance, ATAU admin — lewat endpoint villa-api Excellent Living. */
export function periksaTokenEl(token: string): Promise<HasilPeriksaToken> {
  return periksaToken(token, "/el/whoami");
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

/** Confirms an x-villa-token belongs to a finance OR admin session, by forwarding it to villa-api's own finance-only /finance/whoami. */
export async function isFinanceToken(token: string): Promise<boolean> {
  return tokenPasses(token, "/finance/whoami");
}

/**
 * Siapa saja yang boleh memakai Chat WhatsApp: resepsionis, admin, dan
 * manager (owner 9 Okt 2026: "fitur chat juga bawa ke dashboard Beca").
 * Manager dikunci villa-api hanya ke /manager/*, jadi /summary menolaknya --
 * karena itu dicoba lewat /manager/whoami kalau pemeriksaan staf menolak.
 */
/**
 * Properti di dalam token sesi (multi-properti 2026-11-04). HANYA boleh
 * dipercaya SETELAH token lolos salah satu periksaToken* di atas (villa-api
 * yang memverifikasi tanda tangannya). null = semua properti / token lama.
 */
export function propertiDariToken(token: string): string | null {
  try {
    const isi = JSON.parse(Buffer.from(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { property_kode?: unknown };
    return typeof isi.property_kode === "string" && isi.property_kode ? isi.property_kode : null;
  } catch {
    return null;
  }
}

/** Peran di token sesi (dibaca SETELAH token lolos periksaToken*). */
export function peranDariToken(token: string): string | null {
  try {
    const isi = JSON.parse(Buffer.from(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { role?: unknown };
    return typeof isi.role === "string" ? isi.role : null;
  } catch {
    return null;
  }
}

/**
 * Properti yang sedang dikerjakan peminta: properti akun (manager/
 * resepsionis), atau untuk admin/finance properti pilihannya (header
 * x-villa-property). Bawaan PL. Panggil SETELAH token diverifikasi.
 */
export function propertiPeminta(request: Request, token: string): string {
  const p = propertiDariToken(token);
  if (p) return p;
  const peran = peranDariToken(token);
  if (peran === "admin" || peran === "finance") {
    const h = (request.headers.get("x-villa-property") ?? "").trim().toUpperCase();
    if (/^[A-Z]{2,6}$/.test(h)) return h;
  }
  return "PL";
}

export async function periksaTokenChat(token: string): Promise<HasilPeriksaToken> {
  const staf = await periksaTokenStaf(token);
  // Resepsionis properti mana pun boleh membuka Chat; isinya disaring per
  // properti di rute chat (propertiPeminta). Manager properti lain tidak.
  if (staf !== "ditolak") return staf;
  const manager = await periksaTokenManager(token);
  // Chat WA tamu milik Private Living: manager properti lain tidak ikut membaca.
  if (manager === "lolos") {
    const p = propertiDariToken(token);
    if (p && p !== "PL") return "ditolak";
  }
  return manager;
}

/**
 * Siapa saja yang boleh mengunggah foto KTP saat check-in: staf Private
 * Living (/summary) ATAU resepsionis Excellent Living. Role el_* dikunci
 * villa-api hanya ke /el/*, jadi /summary menolaknya -- karena itu dicoba
 * lewat /el/summary (el_receptionist + admin) kalau pemeriksaan staf menolak.
 */
export async function periksaTokenCheckin(token: string): Promise<HasilPeriksaToken> {
  const staf = await periksaTokenStaf(token);
  if (staf !== "ditolak") return staf;
  return periksaToken(token, "/el/summary");
}
