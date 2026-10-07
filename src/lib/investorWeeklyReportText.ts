import { addDaysISO } from "./stayDates";

/**
 * Laporan mingguan WhatsApp ke investor (owner 2026-10-07): pendapatan,
 * okupansi, dan porsi booking per channel, dikirim tiap 7 hari.
 *
 * Bagian ini murni (tanpa I/O) supaya angka dan teksnya bisa diuji.
 * Aturannya disamakan dengan villa-api, bukan dikarang ulang:
 * - pemasukan diakui = status terjadwal/checkin/checkout dan tanggal
 *   check-in jatuh di minggu laporan (isPemasukanDiakui, 2026-10-05);
 * - bersih = cloudbeds_subtotal untuk booking OTA, = kotor untuk DIRECT
 *   (pendapatanBersih / normalizedChannel).
 * Okupansi = malam-kamar terisi / (jumlah unit x 7 malam).
 */

export const STATUS_DIHITUNG = ["terjadwal", "checkin", "checkout"] as const;
const SUMBER_DIRECT = new Set(["walk-in", "website", "whatsapp", "google", "late-night", "investor"]);

/** Minggu pertama laporan (owner mulai mengirim 7 Okt 2026). */
export const MINGGU_PERTAMA_AKHIR = "2026-10-06";

/** Teks strategi dari owner (2026-10-07). Ganti di sini kalau owner minta. */
export const TEKS_STRATEGI = [
  "• Kerja sama promosi dengan KOL (influencer) masih terus berjalan.",
  "• Program barter menginap dengan KOL untuk sementara belum kami lanjutkan, karena Loonars masih dalam masa soft opening.",
  "• Kami terus meningkatkan kualitas pelayanan Loonars untuk mencapai target *okupansi 80% di akhir 2026*.",
].join("\n");

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

function bersih(b: BookingRingkas): number {
  if (SUMBER_DIRECT.has(String(b.sumber ?? "").toLowerCase())) return kotor(b);
  return b.cloudbeds_subtotal != null ? Number(b.cloudbeds_subtotal) || 0 : kotor(b);
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
  kotor: number;
  bersih: number;
  malamTerisi: number;
  okupansi: number;
  okupansiMingguSebelumnya: number;
  jumlahCheckin: number;
  channelCheckin: PorsiChannel[];
  jumlahBookingBaru: number;
  channelBookingBaru: PorsiChannel[];
  malamTerisiMingguDepan: number;
  okupansiMingguDepan: number;
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
    mingguKe: Math.max(1, Math.round((Date.parse(p.akhir) - Date.parse(MINGGU_PERTAMA_AKHIR)) / (7 * 86400000)) + 1),
    jumlahUnit,
    kotor: checkinMingguIni.reduce((s, b) => s + kotor(b), 0),
    bersih: checkinMingguIni.reduce((s, b) => s + bersih(b), 0),
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
    `• Pendapatan bersih: *${rp(l.bersih)}*`,
    `  (kotor ${rp(l.kotor)}, sudah dikurangi fee OTA)`,
    `• Okupansi: *${persen1(l.okupansi)}* (${l.malamTerisi} dari ${l.jumlahUnit * 7} malam-kamar, ${l.jumlahUnit} unit)`,
    `• Minggu sebelumnya: ${persen1(l.okupansiMingguSebelumnya)}. *${arah}*`,
    `• Tamu check-in: ${l.jumlahCheckin} booking`,
    "",
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
    "🚀 *Strategi & Target*",
    TEKS_STRATEGI,
    "",
    "Terima kasih atas kepercayaan Bapak/Ibu. Kami akan terus melaporkan perkembangannya setiap minggu.",
    "",
    "Salam,",
    "Manajemen Loonars Living",
  );
  return baris.join("\n");
}
