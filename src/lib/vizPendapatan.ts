/**
 * Helper murni untuk diagram halaman Pendapatan & Channel. HANYA tampilan:
 * tidak ada angka keuangan yang dihitung ulang di sini -- semua nilai
 * (kotor, potongan OTA, bersih) datang apa adanya dari villa-api.
 */

/**
 * Palet kategori channel. Diuji dengan validator palet (skill dataviz):
 * lolos rentang terang, chroma, pemisahan buta warna antar-tetangga, dan
 * jarak normal >= 15 untuk tetangga dalam URUTAN INI. Karena itu urutan
 * tumpukan/segmen di diagram selalu mengikuti urutan slot, bukan peringkat.
 * Kuning (slot 3) kontrasnya < 3:1 terhadap kartu, jadi setiap segmen selalu
 * didampingi label nama + tabel.
 */
export const SLOT_CHANNEL = [
  { kunci: "website", warna: "#b4693f" }, // terakota -- kanal milik sendiri
  { kunci: "booking", warna: "#2b7bb0" },
  { kunci: "agoda", warna: "#d4a020" },
  { kunci: "traveloka", warna: "#4f8a3c" },
  { kunci: "investor", warna: "#a5508f" },
] as const;

export const WARNA_LAINNYA = "#8c8172";

/**
 * Indeks slot untuk sebuah sumber (warna mengikuti channel-nya, tidak pernah
 * peringkatnya). -1 = di luar lima channel utama -> abu-abu "Lainnya".
 */
export function slotChannel(sumber: string): number {
  const s = (sumber || "").toLowerCase();
  return SLOT_CHANNEL.findIndex((x) => s.includes(x.kunci));
}

export function warnaChannel(sumber: string): string {
  const i = slotChannel(sumber);
  return i < 0 ? WARNA_LAINNYA : SLOT_CHANNEL[i].warna;
}

/** Urutkan sumber sesuai urutan slot (Lainnya di akhir, lalu alfabetis). */
export function urutSlot<T>(items: T[], ambil: (t: T) => string): T[] {
  const r = (t: T) => {
    const i = slotChannel(ambil(t));
    return i < 0 ? 99 : i;
  };
  return [...items].sort((a, b) => r(a) - r(b) || ambil(a).localeCompare(ambil(b)));
}

/** Batas atas sumbu yang "rapi" (1, 2, 2.5, 5 x 10^n) dan >= nilai maksimum. */
export function batasRapi(maks: number): number {
  if (!(maks > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(maks)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= maks) return k * p;
  return 10 * p;
}

/** Rupiah ringkas untuk sumbu & label kecil: 1,5 Jt / 850 rb / 2 M. */
export function rpRingkas(n: number): string {
  const a = Math.abs(n);
  const f = (v: number) => (Math.round(v * 10) / 10).toLocaleString("id-ID");
  if (a >= 1e9) return `${f(n / 1e9)} M`;
  if (a >= 1e6) return `${f(n / 1e6)} Jt`;
  if (a >= 1e3) return `${Math.round(n / 1e3).toLocaleString("id-ID")} rb`;
  return String(Math.round(n));
}

/** Indeks label sumbu-x yang ditampilkan: pertama, terakhir, dan tiap k. */
export function indeksLabel(n: number, maksLabel = 6): number[] {
  if (n <= 0) return [];
  if (n <= maksLabel) return Array.from({ length: n }, (_, i) => i);
  const k = Math.ceil((n - 1) / (maksLabel - 1));
  const out: number[] = [];
  for (let i = 0; i < n; i += k) out.push(i);
  // Jangan sampai label terakhir menabrak label sebelumnya.
  if (out[out.length - 1] !== n - 1) {
    if (n - 1 - out[out.length - 1] < k / 2) out.pop();
    out.push(n - 1);
  }
  return out;
}

/** Persen bulat untuk porsi; "<1%" bila ada tapi sangat kecil. */
export function persen(bagian: number, total: number): string {
  if (!(total > 0) || !(bagian > 0)) return "0%";
  const p = (bagian / total) * 100;
  if (p < 1) return "<1%";
  return `${Math.round(p)}%`;
}
