/**
 * Barcode Code 128 (set B) tanpa pustaka tambahan, untuk Kartu Priority
 * Investor (owner 2026-11-08: "di kartu ada barcode yg nti bisa discan").
 * Code 128 dibaca semua pemindai barcode kasir biasa (USB/kamera).
 *
 * Hasilnya daftar lebar batang/spasi dalam satuan modul, bergantian mulai
 * dari batang. Tampilan (SVG) dibuat komponen pemanggil.
 */

// Pola lebar untuk nilai 0..106 (104 = Start B, 106 = Stop). Setiap pola
// berjumlah 11 modul; Stop 13 modul.
const POLA = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

export const POLA_CODE128 = POLA;

/** Nilai simbol Code 128B (termasuk start, checksum, stop). */
export function simbolCode128B(teks: string): number[] {
  const nilai = Array.from(teks, (c) => {
    const k = c.charCodeAt(0);
    if (k < 32 || k > 126) throw new Error(`Karakter tidak didukung Code 128B: ${JSON.stringify(c)}`);
    return k - 32;
  });
  const cek = nilai.reduce((jml, v, i) => jml + v * (i + 1), START_B) % 103;
  return [START_B, ...nilai, cek, STOP];
}

/** Lebar batang/spasi bergantian (mulai batang), dalam modul. */
export function lebarCode128B(teks: string): number[] {
  return simbolCode128B(teks).flatMap((s) => Array.from(POLA[s], Number));
}
