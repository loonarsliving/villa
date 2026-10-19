import { addDaysISO } from "./stayDates";

/**
 * Laporan mingguan WhatsApp ke investor (owner 2026-10-07): pendapatan,
 * okupansi, dan porsi booking per channel, dikirim tiap 7 hari.
 *
 * Bagian ini murni (tanpa I/O) supaya angka dan teksnya bisa diuji.
 * Aturannya disamakan dengan villa-api, bukan dikarang ulang:
 * - pemasukan diakui = status terjadwal/checkin/checkout dan tanggal
 *   check-in jatuh di minggu laporan (isPemasukanDiakui, 2026-10-05);
 * - pendapatan = uang yang benar-benar diterima villa setelah komisi OTA
 *   (bersih(), sama dengan pendapatanBersih villa-api dan "Revenue" bagi
 *   hasil investor sejak 2026-10-19). Investor tidak melihat harga kotor
 *   sebelum potongan OTA; fee OTA / marketing tidak disebut.
 * Okupansi = malam-kamar terisi / (jumlah unit x 7 malam).
 */

export const STATUS_DIHITUNG = ["terjadwal", "checkin", "checkout"] as const;
const SUMBER_DIRECT = new Set(["walk-in", "website", "whatsapp", "google", "late-night", "investor", "kol"]);

/** Minggu pertama laporan (owner mulai mengirim 7 Okt 2026). */
export const MINGGU_PERTAMA_MULAI = "2026-09-30";
export const MINGGU_PERTAMA_AKHIR = "2026-10-06";

/**
 * Laporan minggu ke-1 terkirim dengan angka setelah fee OTA (Rp23.106.817);
 * sejak 11 Okt rumusnya pendapatan setelah potongan (sama dengan dashboard
 * investor), jadi minggu ke-1 di rincian kumulatif tampil lebih kecil.
 * Owner 2026-10-14: beri catatan, sebut "potongan OTA", JANGAN "marketing".
 * Hanya di laporan pertama yang memuat total kumulatif (minggu ke-3).
 */
export const CATATAN_PENYESUAIAN_MINGGU_AKHIR = "2026-10-20";
const CATATAN_PENYESUAIAN =
  "_Catatan: mulai laporan ini pendapatan dihitung dari uang yang benar-benar diterima villa setelah potongan OTA, sama dengan dashboard investor, sehingga angka minggu-minggu sebelumnya ikut disesuaikan._";

/** Rincian per minggu hanya ditampilkan selama jumlah minggu masih sedikit. */
const MAKS_RINCIAN_MINGGU = 4;

/**
 * Strategi minggu ini (owner 2026-10-14: "jangan bahasa yang sama dari minggu
 * sebelumnya"). Disusun Claude dari kegiatan yang benar-benar berjalan,
 * DISETUJUI owner, lalu disimpan di integration_settings
 * 'laporan_investor_strategi' = {minggu_akhir, poin[]}. Hanya dipakai bila
 * minggu_akhir sama dengan minggu laporan; kalau belum ada yang disetujui,
 * bagian strategi tidak ditampilkan -- teks minggu lalu tidak diulang.
 */
export interface StrategiMingguan {
  minggu_akhir: string;
  poin: string[];
}

export function strategiUntuk(p: Periode, s: unknown): string[] {
  const v = s as Partial<StrategiMingguan> | null;
  if (!v || v.minggu_akhir !== p.akhir || !Array.isArray(v.poin)) return [];
  return v.poin.map((x) => String(x).trim()).filter(Boolean);
}

export const TEKS_TARGET = "Kami terus meningkatkan kualitas pelayanan Loonars untuk mencapai target *okupansi 80% di akhir 2026*.";

export interface BookingRingkas {
  sumber: string | null;
  status: string;
  unit_nomor: string | null;
  tgl_checkin: string;
  tgl_checkout: string | null;
  total_bayar: number | string | null;
  cloudbeds_subtotal: number | string | null;
  created_at: string;
}

export interface Periode {
  mulai: string; // inklusif, YYYY-MM-DD
  akhir: string; // inklusif (malam terakhir)
}

/** Minggu laporan = 7 malam yang berakhir kemarin (WIB). */
export function periodeMingguLalu(hariIniWIB: string): Periode {
  return { mulai: addDaysISO(hariIniWIB, -7), akhir: addDaysISO(hariIniWIB, -1) };
}

export function geser(p: Periode, hari: number): Periode {
  return { mulai: addDaysISO(p.mulai, hari), akhir: addDaysISO(p.akhir, hari) };
}

export function labelChannel(sumber: string | null): string {
  const s = String(sumber ?? "").toLowerCase();
  if (SUMBER_DIRECT.has(s)) return "Website/Langsung";
  if (s === "agoda") return "Agoda";
  if (s === "booking.com") return "Booking.com";
  if (s === "traveloka") return "Traveloka";
  if (s === "airbnb") return "Airbnb";
  if (s === "tiket") return "Tiket.com";
  return "Lainnya";
}

function kotor(b: BookingRingkas): number {
  return Number(b.total_bayar ?? 0) || 0;
}

/** Komisi OTA per sumber (%), dari finance_ota_settlement_config.commission_pct. */
export type KomisiOta = Record<string, number>;

/**
 * Sama dengan pendapatanBersih() villa-api: booking langsung = total_bayar;
 * booking OTA = harga kamar Cloudbeds (cloudbeds_subtotal) dikurangi komisi
 * channel itu; OTA tanpa subtotal = total_bayar.
 */
export function bersih(b: BookingRingkas, komisi: KomisiOta): number {
  const sumber = String(b.sumber ?? "").toLowerCase();
  if (SUMBER_DIRECT.has(sumber) || b.cloudbeds_subtotal == null) return kotor(b);
  const pct = komisi[sumber] ?? 0;
  return Math.round((Number(b.cloudbeds_subtotal) || 0) * (1 - pct / 100));
}

export function mingguKeDari(akhir: string): number {
  return Math.max(1, Math.round((Date.parse(akhir) - Date.parse(MINGGU_PERTAMA_AKHIR)) / (7 * 86400000)) + 1);
}

export interface PendapatanMinggu {
  mingguKe: number;
  mulai: string;
  akhir: string;
  pendapatan: number;
}

/**
 * Pendapatan tiap minggu sejak minggu ke-1 sampai minggu laporan, dengan
 * rumus yang sama (check-in di minggu itu, bersih()).
 * bookings: booking ber-check-in MINGGU_PERTAMA_MULAI..p.akhir.
 */
export function pendapatanPerMinggu(bookings: BookingRingkas[], p: Periode, komisi: KomisiOta = {}): PendapatanMinggu[] {
  const hasil: PendapatanMinggu[] = [];
  for (let akhir = MINGGU_PERTAMA_AKHIR; akhir <= p.akhir; akhir = addDaysISO(akhir, 7)) {
    const mulai = addDaysISO(akhir, -6);
    const pendapatan = bookings
      .filter((b) => dihitung(b) && b.tgl_checkin >= mulai && b.tgl_checkin <= akhir)
      .reduce((s, b) => s + bersih(b, komisi), 0);
    hasil.push({ mingguKe: mingguKeDari(akhir), mulai, akhir, pendapatan });
  }
  return hasil;
}

function dihitung(b: BookingRingkas): boolean {
  return (STATUS_DIHITUNG as readonly string[]).includes(b.status);
}

/** Jumlah malam-kamar terisi di periode (satu unit satu malam dihitung sekali). */
export function malamKamar(bookings: BookingRingkas[], p: Periode): number {
  const terisi = new Set<string>();
  for (const b of bookings) {
    if (!dihitung(b) || !b.tgl_checkout) continue;
    for (let d = b.tgl_checkin; d < b.tgl_checkout; d = addDaysISO(d, 1)) {
      if (d >= p.mulai && d <= p.akhir) terisi.add(`${b.unit_nomor ?? b.tgl_checkin + b.sumber}|${d}`);
    }
  }
  return terisi.size;
}

export interface PorsiChannel {
  channel: string;
  jumlah: number;
  persen: number;
}

/** Urut dari terbesar; persen dibulatkan tapi total dijaga tetap 100. */
export function porsi(labels: string[]): PorsiChannel[] {
  const hitung = new Map<string, number>();
  for (const l of labels) hitung.set(l, (hitung.get(l) ?? 0) + 1);
  const total = labels.length;
  const baris = [...hitung.entries()]
    .map(([channel, jumlah]) => ({ channel, jumlah, mentah: total ? (jumlah * 100) / total : 0 }))
    .sort((a, b) => b.jumlah - a.jumlah || a.channel.localeCompare(b.channel));
  // Largest remainder supaya 65+24+8+3 tidak jadi 99 atau 101.
  const dasar = baris.map((r) => Math.floor(r.mentah));
  let sisa = total ? 100 - dasar.reduce((s, x) => s + x, 0) : 0;
  const urutSisa = baris.map((r, i) => ({ i, f: r.mentah - dasar[i] })).sort((a, b) => b.f - a.f);
  for (const { i } of urutSisa) {
    if (sisa <= 0) break;
    dasar[i]++;
    sisa--;
  }
  return baris.map((r, i) => ({ channel: r.channel, jumlah: r.jumlah, persen: dasar[i] }));
}

export interface LaporanMingguan {
  periode: Periode;
  mingguKe: number;
  jumlahUnit: number;
  /** Omzet setelah potongan pemasaran -- satu-satunya angka pendapatan yang dikirim ke investor. */
  pendapatan: number;
  malamTerisi: number;
  okupansi: number;
  okupansiMingguSebelumnya: number;
  jumlahCheckin: number;
  channelCheckin: PorsiChannel[];
  jumlahBookingBaru: number;
  channelBookingBaru: PorsiChannel[];
  malamTerisiMingguDepan: number;
  okupansiMingguDepan: number;
  /** Diisi pemanggil (pendapatanPerMinggu); kosong = bagian kumulatif tidak ditampilkan. */
  perMinggu?: PendapatanMinggu[];
  /** Poin strategi yang disetujui owner untuk minggu ini (strategiUntuk). */
  strategi?: string[];
}

/**
 * bookings: semua booking yang menyentuh rentang minggu lalu s/d minggu depan
 * (termasuk yang batal -- disaring di sini). createdAtWIB: tanggal WIB dari
 * created_at, dipakai untuk "booking baru masuk minggu ini".
 */
export function hitungLaporan(
  bookings: BookingRingkas[],
  jumlahUnit: number,
  p: Periode,
  createdAtWIB: (iso: string) => string,
  komisi: KomisiOta = {},
): LaporanMingguan {
  const kapasitas = jumlahUnit * 7;
  const sebelum = geser(p, -7);
  const depan = geser(p, 7);

  const checkinMingguIni = bookings.filter((b) => dihitung(b) && b.tgl_checkin >= p.mulai && b.tgl_checkin <= p.akhir);
  const baru = bookings.filter((b) => {
    if (b.status === "batal") return false;
    const tgl = createdAtWIB(b.created_at);
    return tgl >= p.mulai && tgl <= p.akhir;
  });

  const malamTerisi = malamKamar(bookings, p);
  const malamSebelum = malamKamar(bookings, sebelum);
  const malamDepan = malamKamar(bookings, depan);
  const pct = (n: number) => (kapasitas ? (n * 100) / kapasitas : 0);

  return {
    periode: p,
    mingguKe: mingguKeDari(p.akhir),
    jumlahUnit,
    pendapatan: checkinMingguIni.reduce((s, b) => s + bersih(b, komisi), 0),
    malamTerisi,
    okupansi: pct(malamTerisi),
    okupansiMingguSebelumnya: pct(malamSebelum),
    jumlahCheckin: checkinMingguIni.length,
    channelCheckin: porsi(checkinMingguIni.map((b) => labelChannel(b.sumber))),
    jumlahBookingBaru: baru.length,
    channelBookingBaru: porsi(baru.map((b) => labelChannel(b.sumber))),
    malamTerisiMingguDepan: malamDepan,
    okupansiMingguDepan: pct(malamDepan),
  };
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function tglPendek(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1]}`;
}

function rp(n: number): string {
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

function persen1(n: number): string {
  return `${n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function bagianKumulatif(l: LaporanMingguan): string[] {
  const pm = l.perMinggu ?? [];
  if (pm.length < 2) return [];
  const total = pm.reduce((s, m) => s + m.pendapatan, 0);
  const baris = [`💰 *Total Pendapatan ${pm.length} Minggu* (${tglPendek(pm[0].mulai)} – ${tglPendek(pm[pm.length - 1].akhir)})`];
  if (pm.length <= MAKS_RINCIAN_MINGGU) {
    for (const m of pm) baris.push(`• Minggu ke-${m.mingguKe}: ${rp(m.pendapatan)}`);
  }
  baris.push(`• *Total: ${rp(total)}*`);
  if (l.periode.akhir === CATATAN_PENYESUAIAN_MINGGU_AKHIR) baris.push(CATATAN_PENYESUAIAN);
  baris.push("");
  return baris;
}

export function teksLaporan(l: LaporanMingguan): string {
  const { periode: p } = l;
  const tahun = p.akhir.slice(0, 4);
  const selisih = l.okupansi - l.okupansiMingguSebelumnya;
  const arah =
    Math.abs(selisih) < 0.05
      ? "Stabil."
      : `${selisih > 0 ? "Naik" : "Turun"} ${Math.abs(selisih).toLocaleString("id-ID", { maximumFractionDigits: 1 })} poin.`;
  const depan = geser(p, 7);

  const baris: string[] = [
    "*LAPORAN MINGGUAN LOONARS LIVING*",
    `_Minggu ke-${l.mingguKe}: ${tglPendek(p.mulai)} – ${tglPendek(p.akhir)} ${tahun}_`,
    "",
    "Bapak/Ibu Investor yang kami hormati,",
    "",
  ];
  if (l.mingguKe === 1) {
    baris.push(
      "Mulai minggu ini kami akan mengirimkan laporan singkat setiap minggu, supaya Bapak/Ibu bisa mengikuti perkembangan villa dari dekat.",
      "",
    );
  } else {
    baris.push("Berikut perkembangan Loonars Living minggu ini.", "");
  }

  baris.push(
    "📊 *Kinerja Minggu Ini*",
    `• Pendapatan villa minggu ini: *${rp(l.pendapatan)}*`,
    `• Okupansi: *${persen1(l.okupansi)}* (${l.malamTerisi} dari ${l.jumlahUnit * 7} malam-kamar, ${l.jumlahUnit} unit)`,
    `• Minggu sebelumnya: ${persen1(l.okupansiMingguSebelumnya)}. *${arah}*`,
    `• Tamu check-in: ${l.jumlahCheckin} booking`,
    "",
    ...bagianKumulatif(l),
    "🌐 *Booking per Channel* (tamu yang check-in minggu ini)",
    ...(l.channelCheckin.length
      ? l.channelCheckin.map((c) => `• ${c.channel}: ${c.persen}% (${c.jumlah} booking)`)
      : ["• Belum ada tamu check-in minggu ini"]),
    "",
    `📥 *Booking baru masuk minggu ini: ${l.jumlahBookingBaru}*`,
    l.channelBookingBaru.length ? l.channelBookingBaru.map((c) => `${c.channel} ${c.persen}%`).join(" · ") : "Belum ada booking baru",
    "",
    `📅 *Minggu depan (${tglPendek(depan.mulai)}–${tglPendek(depan.akhir)})*`,
    `Sudah terisi ${l.malamTerisiMingguDepan} malam-kamar (${Math.round(l.okupansiMingguDepan)}%), dan booking masih terus masuk.`,
    "",
    ...(l.strategi?.length ? ["🚀 *Strategi yang Kami Jalankan Minggu Ini*", ...l.strategi.map((x) => `• ${x}`), ""] : []),
    "🎯 *Target*",
    TEKS_TARGET,
    "",
    "Terima kasih atas kepercayaan Bapak/Ibu. Kami akan terus melaporkan perkembangannya setiap minggu.",
    "",
    "Salam,",
    "Manajemen Loonars Living",
  );
  return baris.join("\n");
}
