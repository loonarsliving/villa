import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
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
  return NextResponse.json(data ?? []);
}
