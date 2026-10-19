/**
 * Aturan siapa berwenang atas apa, saat data Cloudbeds bertemu data kita.
 *
 * **Cloudbeds berwenang atas RESERVASINYA**: ada/tidaknya, tanggal, tarif,
 * dibatalkan atau tidak.
 *
 * **Meja depan berwenang atas KEADAAN TAMU DI PROPERTI**: sudah check-in,
 * sudah check-out. Cloudbeds tidak pernah tahu soal ini, karena resepsionis
 * tidak menandai check-in di Cloudbeds — mereka melakukannya di sini, lengkap
 * dengan foto KTP dan tanda tangan tata tertib.
 *
 * Kenapa modul ini ada (kejadian nyata, 2026-09-20):
 * tamu Unit A1 "Ni made rai rusmala Dewi" benar-benar di-check-in resepsionis
 * pukul 14:02 WIB — PIN pintu terkirim, foto KTP dan tanda tangan tersimpan,
 * pemasukan Rp1.188.297 tercatat. Lalu webhook Cloudbeds meng-upsert ulang
 * barisnya dengan `status: "terjadwal"` yang dipatok keras, dan status
 * check-in-nya hilang. Akibatnya:
 *
 *  1. Meja depan menampilkan tamu yang sedang menginap sebagai "Menunggu
 *     Check-In", padahal orangnya sudah di dalam villa (units.status tetap
 *     'occupied' — datanya jadi bertentangan sendiri).
 *  2. Tamu itu TIDAK BISA di-check-out, karena `villa_commit_checkout`
 *     mensyaratkan status 'checkin'.
 *  3. Kalau resepsionis check-in ulang — yang wajar dilakukan karena
 *     layarnya bilang belum check-in — `villa_commit_checkin` menerimanya
 *     dan mencatat pemasukan untuk KEDUA KALINYA, lalu ikut masuk ke bagi
 *     hasil investor 70/30.
 */

export type StatusBooking = "terjadwal" | "checkin" | "checkout" | "batal" | "menunggu_pembayaran";

/**
 * Status yang boleh ditulis sync/webhook, dengan menghormati keadaan yang
 * hanya diketahui meja depan.
 *
 * `null` untuk `statusSekarang` berarti booking-nya belum ada.
 */
export function statusSetelahSync(
  statusSekarang: string | null | undefined,
  statusDariCloudbeds: string,
): string {
  // Sekali tamu masuk atau keluar, Cloudbeds tidak boleh menariknya mundur.
  if (statusSekarang === "checkin" || statusSekarang === "checkout") return statusSekarang;
  return statusDariCloudbeds;
}

/**
 * Apakah booking ini LAHIR di sistem kita (dipesan lewat loonars.id lalu
 * didorong ke Cloudbeds), sehingga salinan Cloudbeds tidak boleh menimpanya.
 *
 * Penandanya tiga, dan semuanya perlu: villa-api membuat booking website
 * dengan `sumber='website'` dan mencantumkan "[Website]" di catatan; booking
 * berkupon memakai sumber 'investor' / 'kol', catatan "[Menginap ...]" /
 * "[Kupon KOL]", dan kolom voucher_id / kol_voucher_id / is_free_stay. Kalau
 * sebuah sync terlanjur menimpa `sumber` jadi 'cloudbeds', penanda lainnya
 * masih menyelamatkan.
 *
 * Dulu penandanya `sumber !== 'cloudbeds'`, dan itu SALAH sejak webhook mulai
 * memetakan nama sumber OTA ke nilai aslinya: booking Agoda yang sah jadi
 * ber-`sumber='agoda'`, lolos tes itu, dan ikut dilewati sync — sehingga
 * pembatalan atau perubahan tanggal dari Cloudbeds tidak pernah sampai ke
 * booking OTA mana pun.
 */
export function dibuatDiSini(
  sumber: string | null | undefined,
  catatan: string | null | undefined,
  kupon?: PenandaKupon | null,
): boolean {
  if (sumber === "website" || sumber === "investor" || sumber === "kol") return true;
  const c = String(catatan ?? "");
  if (PENANDA_CATATAN.some((p) => c.includes(p))) return true;
  // Kolom kupon adalah penanda yang paling tahan banting: sumber dan catatan
  // bisa ditimpa (sync Cloudbeds menimpa sumber, check-out menimpa catatan),
  // tetapi voucher_id / kol_voucher_id / is_free_stay tidak pernah ditulis
  // ulang oleh sync mana pun.
  return !!(kupon?.is_free_stay || kupon?.voucher_id || kupon?.kol_voucher_id);
}

/** Kolom bookings yang menandai booking berkupon (menginap gratis investor / kupon KOL). */
export interface PenandaKupon {
  is_free_stay?: boolean | null;
  voucher_id?: string | null;
  kol_voucher_id?: string | null;
}

/**
 * Awalan catatan yang dipasang villa-api pada booking buatan loonars.id.
 * Booking berkupon TIDAK memakai "[Website]" -- itu sebabnya sync Cloudbeds
 * dulu menimpa booking investor dan KOL (2026-10-19).
 */
const PENANDA_CATATAN = ["[Website]", "[Menginap gratis investor]", "[Menginap investor]", "[Kupon KOL]"];
