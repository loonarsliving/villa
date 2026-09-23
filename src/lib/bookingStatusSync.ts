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
 * Penandanya dua, dan keduanya perlu: villa-api membuat booking website
 * dengan `sumber='website'` dan mencantumkan "[Website]" di catatan. Kalau
 * sebuah sync terlanjur menimpa `sumber` jadi 'cloudbeds', catatannya masih
 * menyelamatkan.
 *
 * Dulu penandanya `sumber !== 'cloudbeds'`, dan itu SALAH sejak webhook mulai
 * memetakan nama sumber OTA ke nilai aslinya: booking Agoda yang sah jadi
 * ber-`sumber='agoda'`, lolos tes itu, dan ikut dilewati sync — sehingga
 * pembatalan atau perubahan tanggal dari Cloudbeds tidak pernah sampai ke
 * booking OTA mana pun.
 */
export function dibuatDiSini(sumber: string | null | undefined, catatan: string | null | undefined): boolean {
  return sumber === "website" || String(catatan ?? "").includes("[Website]");
}
