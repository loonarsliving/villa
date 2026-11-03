import { NextResponse } from "next/server";

import { PENANDA_BLOK } from "@/lib/elCloudbedsLogic";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { periksaTokenManager, propertiDariToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manager villa membuka/menahan kamar Excellent Living (owner 2026-11-03:
 * "maintenancekan semua kamar sampai nti bisa diaktifkan dihalaman manager
 * villa"). Kamar baru dari Cloudbeds masuk sebagai maintenance; manager yang
 * mengaktifkan. Kamar yang diblokir di Cloudbeds tetap tertutup (sinkron EL
 * menutupnya lagi) sampai blokirnya dibuka di Cloudbeds.
 */

async function sesi(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const hasil = token ? await periksaTokenManager(token) : "ditolak";
  if (hasil === "gagal-periksa") return NextResponse.json({ error: "Sesi tidak bisa diperiksa, coba lagi" }, { status: 503 });
  if (hasil !== "lolos") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Token sudah diverifikasi villa-api di atas. Manager properti lain (bukan
  // PL/EL) tidak boleh mengatur kamar EL.
  const p = propertiDariToken(token);
  if (p && p !== "PL" && p !== "EL") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  const tolak = await sesi(request);
  if (tolak) return tolak;
  const { data, error } = await supabaseAdmin()
    .from("el_rooms")
    .select("id, nomor, status, catatan, sort_order, el_room_types(nama, sort_order)")
    .eq("active", true)
    .order("sort_order")
    .order("nomor");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    (data ?? []).map((r) => ({ ...r, diblokir_cloudbeds: String(r.catatan ?? "").includes(PENANDA_BLOK) })),
  );
}

export async function PATCH(request: Request) {
  const tolak = await sesi(request);
  if (tolak) return tolak;
  const b = (await request.json().catch(() => ({}))) as { ids?: unknown; aktif?: unknown };
  const ids = Array.isArray(b.ids) ? b.ids.map(String).filter(Boolean) : [];
  if (!ids.length || typeof b.aktif !== "boolean") return NextResponse.json({ error: "ids dan aktif wajib diisi" }, { status: 400 });
  const supabase = supabaseAdmin();
  const { data: kamar, error } = await supabase.from("el_rooms").select("id, status, catatan").in("id", ids).eq("active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const sekarang = new Date().toISOString();
  let diubah = 0;
  const dilewati: string[] = [];
  for (const k of kamar ?? []) {
    const blok = String(k.catatan ?? "").includes(PENANDA_BLOK);
    if (b.aktif) {
      // Hanya kamar maintenance yang dibuka; kamar terisi/kotor dibiarkan.
      // Kamar yang masih diblokir di Cloudbeds tidak bisa dibuka dari sini.
      if (k.status !== "maintenance" || blok) {
        dilewati.push(k.id);
        continue;
      }
      await supabase.from("el_rooms").update({ status: "available", updated_at: sekarang }).eq("id", k.id).eq("status", "maintenance");
      diubah++;
    } else {
      if (k.status !== "available") {
        dilewati.push(k.id);
        continue;
      }
      await supabase.from("el_rooms").update({ status: "maintenance", updated_at: sekarang }).eq("id", k.id).eq("status", "available");
      diubah++;
    }
  }
  return NextResponse.json({ diubah, dilewati });
}
