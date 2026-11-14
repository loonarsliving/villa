import { NextResponse } from "next/server";

import { getCloudbedsRatePlans, parseRoomsAvailableByRoomType } from "@/lib/cloudbedsApi";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Kamar yang masih dijual Cloudbeds EL per tipe untuk [checkin, checkout)
 * (hanya baca). Dipakai villa-api sebelum menjual kamar EL di loonars.id:
 * reservasi OTA yang belum tersinkron atau blokir kamar tetap mengurangi
 * jumlah ini, jadi Cloudbeds sendiri yang menjadi penentu terakhir.
 * Hasil: { tipe: { <roomTypeID>: jumlah terkecil di seluruh malam } }.
 * Hanya rahasia cron. Sejak 2026-11-14 juga untuk PL (?properti=PL, akun
 * Cloudbeds utama): website PL sempat menjual B1 31 Des & B3 30 Des yang
 * kemudian ditolak Cloudbeds ("could not accommodate") karena hanya
 * reservasi yang dibandingkan, bukan jumlah kamar yang dibuka Cloudbeds.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const checkin = url.searchParams.get("checkin") ?? "";
  const checkout = url.searchParams.get("checkout") ?? "";
  const kode = (url.searchParams.get("properti") ?? "EL").trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(kode)) return NextResponse.json({ error: "properti tidak valid" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout) || checkout <= checkin) {
    return NextResponse.json({ error: "checkin/checkout tidak valid" }, { status: 400 });
  }
  try {
    const { akun } = await siapkanAkunCloudbeds(kode);
    const plans = await getCloudbedsRatePlans(checkin, checkout, akun);
    const perTipe = parseRoomsAvailableByRoomType(plans);
    const malam: string[] = [];
    for (let d = Date.parse(`${checkin}T00:00:00Z`); d < Date.parse(`${checkout}T00:00:00Z`); d += 86400000) malam.push(new Date(d).toISOString().slice(0, 10));
    const tipe: Record<string, number> = {};
    for (const [id, perTgl] of perTipe) {
      // Malam yang tidak ada di jawaban dianggap 0 (tidak dijual).
      tipe[id] = Math.min(...malam.map((m) => perTgl.get(m) ?? 0));
    }
    return NextResponse.json({ checkin, checkout, tipe });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
