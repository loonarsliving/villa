import { NextResponse } from "next/server";

import { getCloudbedsAvailabilityForDate, getCloudbedsRoomBlocks, getCloudbedsRooms, CloudbedsApiError } from "@/lib/cloudbedsApi";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pemeriksaan sisi Cloudbeds: "kalau tamu mencari tanggal ini hari ini,
 * apakah villa muncul dan bisa dipesan?"
 *
 * Dibuat 14 Sep 2026 karena owner bertanya kenapa pemesanan turun dan tidak
 * ada satu pun cara menjawabnya dari data kita sendiri. Tabel rate hanya
 * bercerita soal HARGA; ia tetap terlihat sehat walaupun tanggalnya sudah
 * tidak bisa dipesan siapa pun karena kamar ditutup, minimum menginap, atau
 * stop-sell. Dua keadaan yang sangat berbeda itu tampak sama dari sisi kita,
 * dan perbedaannya persis yang menentukan ada tidaknya pemesanan.
 *
 * MURNI BACA. Tidak ada satu nilai pun yang ditulis ke Cloudbeds atau ke
 * database -- endpoint ini tidak boleh bisa memperbaiki apa pun, hanya
 * memberi tahu apa yang sedang terjadi.
 */

function tambahHari(tanggal: string, n: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hariIniJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const mulai = url.searchParams.get("mulai") ?? hariIniJakarta();
  // Dibatasi 45 hari: tiap tanggal satu panggilan API, dan permintaan yang
  // berjalan menit-menitan akan mati di tengah jalan tanpa hasil apa pun.
  const jumlahHari = Math.min(45, Math.max(1, Number(url.searchParams.get("hari") ?? 30)));

  try {
    const rooms = await getCloudbedsRooms();

    const tanggal: string[] = [];
    for (let i = 0; i < jumlahHari; i++) tanggal.push(tambahHari(mulai, i));

    // Berurutan, bukan serentak: Cloudbeds membatasi laju panggilan, dan
    // tiga puluh permintaan sekaligus akan dijawab 429 -- yang akan terbaca
    // seperti "tanggalnya tidak bisa dipesan", persis kesimpulan salah yang
    // ingin dihindari alat ini.
    const harian = [];
    for (const t of tanggal) {
      harian.push(await getCloudbedsAvailabilityForDate(t, tambahHari(t, 1)));
    }

    // Blokir kamar: tersangka pertama untuk tanggal yang harganya terpasang
    // tapi tidak bisa dipesan. Kegagalan membacanya tidak boleh menggagalkan
    // seluruh pemeriksaan -- bagian yang sudah terbaca tetap berguna.
    let blokir: unknown[] | { error: string };
    try {
      blokir = await getCloudbedsRoomBlocks(mulai, tambahHari(mulai, Math.min(34, jumlahHari - 1)));
    } catch (e) {
      blokir = { error: e instanceof Error ? e.message : String(e) };
    }

    const tidakBisaDipesan = harian.filter((h) => !h.bookable && !h.error);
    const gagalDibaca = harian.filter((h) => h.error);

    return NextResponse.json({
      properti: { jumlah_kamar_terdaftar: rooms.length },
      periode: { mulai, hari: jumlahHari, sampai: tambahHari(mulai, jumlahHari - 1) },
      ringkasan: {
        bisa_dipesan: harian.length - tidakBisaDipesan.length - gagalDibaca.length,
        tidak_bisa_dipesan: tidakBisaDipesan.length,
        gagal_dibaca: gagalDibaca.length,
        tanggal_tidak_bisa_dipesan: tidakBisaDipesan.map((h) => h.date),
      },
      blokir_kamar: blokir,
      harian,
    });
  } catch (e) {
    const status = e instanceof CloudbedsApiError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
