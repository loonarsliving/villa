import type { FinanceChecklistItem } from "./types";

/**
 * Rencana kas bulan ini untuk halaman Finance (owner 2026-10-21): uang
 * sudah di mana, akan cair kapan, keluar ke mana (dividen), dan berapa sisa
 * di akhir bulan -- supaya meski Agoda belum cair, arah uangnya sudah
 * kelihatan.
 *
 * Murni tampilan Finance. TIDAK dipakai investor dan tidak mengubah rumus
 * bagi hasil: selama masa garansi, dividen di sini = Rp5 jt per unit tetap
 * (garansi didahulukan atas rumus bagi hasil, keputusan owner). Gaji dan
 * biaya tetap hanya indikator, tidak dikurangkan dari sisa kas.
 *
 * Aturan yang sengaja dijaga:
 * - Settlement yang jatuh tempo SEBELUM hari ini, atau channel langsung
 *   (website/walk-in, dibayar di muka) tanpa jadwal, tapi belum ditandai
 *   diterima (`lewatTempo`) TIDAK dijumlahkan ke dana yang akan masuk: besar
 *   kemungkinan sudah ada di saldo rekening yang diketik owner, jadi
 *   menghitungnya lagi akan menghitung dua kali.
 * - Pemasukan sisa bulan hanya "potensi" dari asumsi owner; yang sudah
 *   terbooking (pipeline) dihitung sebagai bagian dari asumsi itu, bukan
 *   ditambahkan lagi.
 */

export const GARANSI_PER_UNIT = 5_000_000;
/** Batas transfer dividen: tanggal 25 jam 20.00 WIB (villa-api /cron/dividend-list). */
export const TANGGAL_DIVIDEN = 25;
export const ASUMSI_PER_HARI_DEFAULT = 5_000_000;

export interface BarisCair {
  sumber: string;
  tanggal: string;
  jumlah: number;
  booking: number;
}

export interface BarisTertahan {
  sumber: string;
  jumlah: number;
  booking: number;
  paling_awal: string | null;
  paling_akhir: string | null;
}

export interface RencanaKasInput {
  hariIni: string;
  items: FinanceChecklistItem[];
  /** Pemasukan booking yang check-in-nya belum tiba sampai akhir bulan (FinanceSummary.pipeline.amount). */
  pipeline: number;
  /** Net revenue bulan ini sampai hari ini (FinanceSummary.net_revenue). */
  netBulanIni: number;
  saldo: number;
  unitDividen: number;
  asumsiPerHari: number;
}

export interface RencanaKas {
  bulan: string;
  awalBulan: string;
  akhirBulan: string;
  tanggalDividen: string;
  sisaHari: number;
  sudahCairBulanIni: number;
  akanCair: number;
  akanCairSampaiDividen: number;
  akanCairPerBaris: BarisCair[];
  lewatTempo: number;
  lewatTempoBooking: number;
  tertahan: number;
  tertahanPerChannel: BarisTertahan[];
  tanpaJadwal: number;
  dividen: number;
  tersediaSaatDividen: number;
  selisihDividen: number;
  sisaKasPasti: number;
  piutang: number;
  potensiAsumsi: number;
  potensiTerbooking: number;
  potensiTambahan: number;
  potensiTotal: number;
  posisiTotal: number;
  rataRataHarianNyata: number;
}

export function akhirBulanISO(hariIni: string): string {
  const [y, m] = hariIni.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function hitungRencanaKas(i: RencanaKasInput): RencanaKas {
  const bulan = i.hariIni.slice(0, 7);
  const awalBulan = `${bulan}-01`;
  const akhirBulan = akhirBulanISO(i.hariIni);
  const tanggalDividen = `${bulan}-${String(TANGGAL_DIVIDEN).padStart(2, "0")}`;
  const sisaHari = Math.max(0, Math.round((Date.parse(akhirBulan) - Date.parse(i.hariIni)) / 86400000));

  let sudahCairBulanIni = 0;
  let akanCair = 0;
  let akanCairSampaiDividen = 0;
  let lewatTempo = 0;
  let lewatTempoBooking = 0;
  let tertahan = 0;
  let tanpaJadwal = 0;
  const cair = new Map<string, BarisCair>();
  const tahan = new Map<string, BarisTertahan>();

  for (const it of i.items) {
    if (it.masuk) {
      const tgl = it.received_date ?? "";
      if (tgl >= awalBulan && tgl <= i.hariIni) sudahCairBulanIni += it.amount_received ?? it.seharusnya;
      continue;
    }
    const sumber = it.sumber ?? "-";
    const exp = it.expected_settlement_date;
    if (!exp && it.normalized_channel === "DIRECT") {
      // Website/walk-in dibayar tamu di muka dan tidak punya jadwal cair: belum
      // ditandai diterima, tapi uangnya kemungkinan besar sudah di rekening.
      lewatTempo += it.seharusnya;
      lewatTempoBooking++;
    } else if (!exp) {
      tanpaJadwal += it.seharusnya;
    } else if (exp < i.hariIni) {
      lewatTempo += it.seharusnya;
      lewatTempoBooking++;
    } else if (exp <= akhirBulan) {
      akanCair += it.seharusnya;
      if (exp <= tanggalDividen) akanCairSampaiDividen += it.seharusnya;
      const k = `${sumber}|${exp}`;
      const b = cair.get(k) ?? { sumber, tanggal: exp, jumlah: 0, booking: 0 };
      b.jumlah += it.seharusnya;
      b.booking++;
      cair.set(k, b);
    } else {
      tertahan += it.seharusnya;
      const b = tahan.get(sumber) ?? { sumber, jumlah: 0, booking: 0, paling_awal: null, paling_akhir: null };
      b.jumlah += it.seharusnya;
      b.booking++;
      b.paling_awal = b.paling_awal && b.paling_awal < exp ? b.paling_awal : exp;
      b.paling_akhir = b.paling_akhir && b.paling_akhir > exp ? b.paling_akhir : exp;
      tahan.set(sumber, b);
    }
  }

  const dividen = i.unitDividen * GARANSI_PER_UNIT;
  const sisaKasPasti = i.saldo + akanCair - dividen;
  const piutang = tertahan + tanpaJadwal;
  const potensiAsumsi = i.asumsiPerHari * sisaHari;
  const potensiTotal = Math.max(potensiAsumsi, i.pipeline);

  // Dividen dibayar tanggal 25: kalau hari ini sudah lewat tanggal itu, yang
  // tersedia saat transfer tidak bisa dihitung ulang; pakai saldo sekarang.
  const tersediaSaatDividen = i.saldo + (i.hariIni <= tanggalDividen ? akanCairSampaiDividen : 0);

  return {
    bulan,
    awalBulan,
    akhirBulan,
    tanggalDividen,
    sisaHari,
    sudahCairBulanIni,
    akanCair,
    akanCairSampaiDividen,
    akanCairPerBaris: [...cair.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.sumber.localeCompare(b.sumber)),
    lewatTempo,
    lewatTempoBooking,
    tertahan,
    tertahanPerChannel: [...tahan.values()].sort((a, b) => b.jumlah - a.jumlah),
    tanpaJadwal,
    dividen,
    tersediaSaatDividen,
    selisihDividen: tersediaSaatDividen - dividen,
    sisaKasPasti,
    piutang,
    potensiAsumsi,
    potensiTerbooking: i.pipeline,
    potensiTambahan: Math.max(0, potensiAsumsi - i.pipeline),
    potensiTotal,
    posisiTotal: sisaKasPasti + piutang + potensiTotal,
    rataRataHarianNyata: i.netBulanIni / Number(i.hariIni.slice(8, 10)),
  };
}

function hariBulanBerjalan(hariIni: string): number {
  return Number(hariIni.slice(8, 10));
}
