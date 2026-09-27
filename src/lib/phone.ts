/**
 * Pencocokan nomor HP Indonesia lintas format.
 *
 * Diperlukan karena `guests.hp` di database tersimpan TIDAK konsisten --
 * diperiksa langsung (2026-09-27): ada yang berawalan "0" (mis.
 * "081283012301823"), ada yang sudah "62" (mis. "6282225908417"), dan
 * banyak yang kosong. Nomor pengirim WhatsApp (`payload.from` dari
 * WhaCenter) juga tidak dijamin memakai awalan yang sama dengan yang
 * diketik staf saat mencatat tamu. Membandingkan string apa adanya akan
 * melewatkan pasangan yang sebenarnya nomor yang sama.
 *
 * Pendekatannya: potong ke "nomor signifikan nasional" -- buang semua yang
 * bukan digit, lalu buang SATU awalan "0" atau "62" di depan (tidak
 * keduanya, dan bukan diulang) -- dan bandingkan sisanya.
 */

/** Sama seperti sanitizeNumber() di whacenter.ts -- digit saja, tidak lebih. */
export function onlyDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/**
 * Nomor signifikan nasional: buang satu awalan negara/trunk di depan digit.
 * "081283012301823" -> "81283012301823"
 * "6282225908417"   -> "82225908417"
 * "82225908417"     -> "82225908417" (tidak ada awalan, dibiarkan)
 */
export function nationalSignificantNumber(phone: string): string {
  const digits = onlyDigits(phone);
  if (digits.startsWith("62")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/**
 * Satu bentuk simpan untuk nomor Indonesia: awalan "0" diganti "62".
 * WhaCenter mengirim `from` berawalan "0" (mis. "0811400441") sedangkan
 * nomor lain di sistem memakai "62" -- tanpa ini satu tamu bisa punya dua
 * percakapan terpisah. Nomor luar negeri (tanpa awalan "0") dibiarkan.
 */
export function nomorKanonik(phone: string): string {
  const digits = onlyDigits(phone);
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

/**
 * Dua nomor dianggap sama kalau nomor signifikan nasionalnya sama DAN
 * cukup panjang untuk berarti (mencegah dua nomor kosong/rusak "match"
 * satu sama lain -- minimal 8 digit, di bawah itu bukan nomor HP Indonesia
 * yang masuk akal).
 */
export function samePhoneNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = nationalSignificantNumber(a);
  const nb = nationalSignificantNumber(b);
  return na.length >= 8 && na === nb;
}
