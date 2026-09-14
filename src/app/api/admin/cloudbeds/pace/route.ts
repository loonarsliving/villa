import { NextResponse } from "next/server";

import { CloudbedsApiError } from "@/lib/cloudbedsApi";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Kapan pemesanan itu DIBUAT -- bukan kapan kita menariknya.
 *
 * Dibuat 14 Sep 2026 karena owner bertanya kenapa beberapa hari terakhir
 * lebih sepi, dan `bookings.created_at` TIDAK BISA menjawabnya: kolom itu
 * berisi waktu sinkronisasi memasukkan barisnya, bukan waktu tamu memesan.
 * Sinkronisasi pertama berjalan 11 September, jadi seluruh pesanan lama
 * menumpuk di tanggal itu dan menghasilkan grafik menurun yang sepenuhnya
 * palsu -- persis kesimpulan yang hampir saya laporkan.
 *
 * Cloudbeds menyimpan waktu sebenarnya di `dateCreated`. Endpoint ini
 * membacanya langsung dan mengelompokkan per tanggal pemesanan, sehingga
 * "pace" yang terlihat adalah pace yang sungguhan.
 *
 * MURNI BACA: tidak menulis ke Cloudbeds maupun database.
 */

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";

interface ReservationRingkas {
  reservationID: string;
  dateCreated?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  sourceName?: string | null;
  total?: number | string | null;
}

export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const key = (process.env.CLOUDBEDS_API_KEY ?? "").trim();
  if (!key) {
    return NextResponse.json({ error: "CLOUDBEDS_API_KEY belum dikonfigurasi" }, { status: 503 });
  }
  const propertyId = (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim();

  const url = new URL(request.url);
  // Hanya pemesanan yang DIBUAT sejak tanggal ini. Menyaring di sisi
  // Cloudbeds, bukan setelah semuanya ditarik: properti dengan riwayat
  // panjang akan menghabiskan batas waktu permintaan sebelum sempat
  // menjawab apa pun.
  const sejak = url.searchParams.get("sejak") ?? "2026-09-01";

  try {
    const all: ReservationRingkas[] = [];
    let pageNumber = 1;
    const pageSize = 100;
    for (;;) {
      const u = new URL(`${CLOUDBEDS_API_BASE}/getReservations`);
      if (propertyId) u.searchParams.set("propertyID", propertyId);
      // resultsFrom, bukan createdFrom -- parameter itu tidak ada. Spesifikasi
      // pms-v1.2 menyebut resultsFrom "used to filter reservations, based on
      // booking date", yaitu persis tanggal pemesanan yang dicari di sini.
      u.searchParams.set("resultsFrom", sejak);
      u.searchParams.set("pageNumber", String(pageNumber));
      u.searchParams.set("pageSize", String(pageSize));
      const res = await fetch(u, { headers: { "x-api-key": key }, cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success === false) {
        throw new CloudbedsApiError(body?.message || body?.error || `getReservations HTTP ${res.status}`, res.status >= 400 ? res.status : 502);
      }
      const rows = (body?.data ?? []) as ReservationRingkas[];
      all.push(...rows);
      if (rows.length < pageSize) break;
      pageNumber++;
      if (pageNumber > 20) break;
    }

    const perHari = new Map<string, { jumlah: number; nilai: number; untuk: string[] }>();
    for (const r of all) {
      const dibuat = String(r.dateCreated ?? "").slice(0, 10) || "(tanpa tanggal)";
      const baris = perHari.get(dibuat) ?? { jumlah: 0, nilai: 0, untuk: [] };
      baris.jumlah += 1;
      const nilai = Number(r.total);
      if (Number.isFinite(nilai)) baris.nilai += nilai;
      if (r.startDate) baris.untuk.push(String(r.startDate));
      perHari.set(dibuat, baris);
    }

    const pace = [...perHari.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tanggal, v]) => ({
        tanggal_pemesanan: tanggal,
        jumlah: v.jumlah,
        nilai: Math.round(v.nilai),
        untuk_checkin: v.untuk.sort(),
      }));

    return NextResponse.json({
      sejak,
      total_pemesanan: all.length,
      pace,
      // Sumber pemesanan ikut dihitung: pergeseran kanal (OTA mana yang
      // mengirim tamu) sering menjelaskan perubahan pace lebih baik
      // daripada jumlahnya sendiri.
      per_sumber: [...all.reduce((m, r) => {
        const s = String(r.sourceName ?? "(tidak diketahui)");
        m.set(s, (m.get(s) ?? 0) + 1);
        return m;
      }, new Map<string, number>())].map(([sumber, jumlah]) => ({ sumber, jumlah })),
    });
  } catch (e) {
    const status = e instanceof CloudbedsApiError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
