import { NextResponse } from "next/server";

import { CloudbedsApiError } from "@/lib/cloudbedsApi";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";
import { hargaElDariCloudbeds } from "@/lib/elHarga";
import { supabaseAdminProperti } from "@/lib/supabaseAdmin";
import { periksaTokenEl } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TGL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Harga kamar Excellent Living dari Cloudbeds untuk [checkin, checkout),
 * per tipe kamar. Untuk front desk EL (isi otomatis Total Bayar), admin
 * (kalender harga), dan finance. Hanya membaca Cloudbeds.
 */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenEl(token) : "ditolak";
  if (sesi === "gagal-periksa") return NextResponse.json({ error: "Sesi tidak bisa diperiksa, coba lagi" }, { status: 503 });
  if (sesi !== "lolos") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const checkin = url.searchParams.get("checkin") ?? "";
  const checkout = url.searchParams.get("checkout") ?? "";
  if (!TGL.test(checkin) || !TGL.test(checkout) || checkout <= checkin) {
    return NextResponse.json({ error: "checkin/checkout harus YYYY-MM-DD dan checkout setelah checkin" }, { status: 400 });
  }
  if ((Date.parse(checkout) - Date.parse(checkin)) / 86400000 > 62) {
    return NextResponse.json({ error: "Maksimal 62 malam" }, { status: 400 });
  }
  try {
    const kode = (url.searchParams.get("properti") ?? "EL").trim().toUpperCase();
    if (!/^[A-Z]{2,6}$/.test(kode) || kode === "PL") return NextResponse.json({ error: "properti tidak valid" }, { status: 400 });
    const { akun } = await siapkanAkunCloudbeds(kode);
    return NextResponse.json({ checkin, checkout, ...(await hargaElDariCloudbeds(supabaseAdminProperti(kode), checkin, checkout, akun)) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: e instanceof CloudbedsApiError ? e.status : 502 });
  }
}
