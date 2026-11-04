import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bacaKonfigProperti } from "@/lib/propertiConfig";
import { periksaTokenFinance } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daftar properti untuk halaman Pilih Properti (admin & finance). */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenFinance(token) : "ditolak";
  if (sesi === "gagal-periksa") return NextResponse.json({ error: "Sesi tidak bisa diperiksa, coba lagi" }, { status: 503 });
  if (sesi !== "lolos") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin().from("villa_properties").select("kode, nama, aktif, created_at").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // `siap` = fitur operasional properti dibuka (PL & EL selalu; properti baru
  // setelah admin menyelesaikan wizard Tambah Properti).
  const hasil = await Promise.all(
    (data ?? []).map(async (p) => ({
      ...p,
      siap: p.kode === "PL" || p.kode === "EL" ? true : (await bacaKonfigProperti(String(p.kode))).siap === true,
    })),
  );
  return NextResponse.json(hasil);
}
