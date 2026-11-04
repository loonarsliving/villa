import { NextResponse } from "next/server";

import { bacaSetelanHarga, kunciSetelanHarga, runDynamicPricingProperti } from "@/lib/elDynamicPricing";
import { supabaseAdminProperti } from "@/lib/supabaseAdmin";
import { periksaTokenAdmin, propertiNonPl } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function sesiAdmin(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenAdmin(token) : "ditolak";
  if (sesi === "gagal-periksa") return NextResponse.json({ error: "Sesi tidak bisa diperiksa, coba lagi" }, { status: 503 });
  if (sesi !== "lolos") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/** Properti non-PL: ?properti=XX, atau pilihan admin (header), bawaan EL. */
function kodeProperti(request: Request): string | null {
  return propertiNonPl(request, request.headers.get("x-villa-token") ?? "");
}

/** Setelan + rekomendasi terakhir dynamic pricing properti (bawaan EL), dan batas bawah/atas per tipe. */
export async function GET(request: Request) {
  const tolak = await sesiAdmin(request);
  if (tolak) return tolak;
  const kode = kodeProperti(request);
  if (!kode) return NextResponse.json({ error: "properti tidak valid" }, { status: 400 });
  const setelan = await bacaSetelanHarga(kode);
  const { data: tipe } = await supabaseAdminProperti(kode).from("villa_room_types").select("id, code, name, min_rate, max_rate").eq("active", true).order("name");
  return NextResponse.json({ ...setelan, tipe: tipe ?? [] });
}

/**
 * aksi: 'jalankan' (hitung ulang, TIDAK mengirim), 'autopush' {nilai},
 * 'batas' {kode, min_rate, max_rate}. Saklar auto-push dan batas harga
 * diubah pemilik lewat halaman Harga EL.
 */
export async function POST(request: Request) {
  const tolak = await sesiAdmin(request);
  if (tolak) return tolak;
  const b = (await request.json().catch(() => ({}))) as { aksi?: string; nilai?: unknown; kode?: unknown; min_rate?: unknown; max_rate?: unknown };
  const kode = kodeProperti(request);
  if (!kode) return NextResponse.json({ error: "properti tidak valid" }, { status: 400 });
  const db = supabaseAdminProperti(kode);
  try {
    if (b.aksi === "jalankan") return NextResponse.json(await runDynamicPricingProperti(kode, { paksaKirim: false }));
    if (b.aksi === "autopush") {
      if (typeof b.nilai !== "boolean") return NextResponse.json({ error: "nilai harus true/false" }, { status: 400 });
      const s = await bacaSetelanHarga(kode);
      if (b.nilai) {
        const { data: tipe } = await db.from("villa_room_types").select("code, min_rate, max_rate").eq("active", true);
        const kurang = (tipe ?? []).filter((t) => !t.min_rate || !t.max_rate).map((t) => t.code);
        if (kurang.length) return NextResponse.json({ error: `Batas bawah/atas belum diatur untuk: ${kurang.join(", ")}` }, { status: 409 });
      }
      const { error } = await db.from("integration_settings").upsert({ key: kunciSetelanHarga(kode), value: { ...s, autopush: b.nilai } }, { onConflict: "key" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ autopush: b.nilai });
    }
    if (b.aksi === "batas") {
      const min = Number(b.min_rate), max = Number(b.max_rate);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return NextResponse.json({ error: "Batas bawah harus > 0 dan tidak melebihi batas atas" }, { status: 400 });
      const { data, error } = await db.from("villa_room_types").update({ min_rate: Math.round(min), max_rate: Math.round(max), updated_at: new Date().toISOString() }).eq("code", String(b.kode)).select("code").maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Tipe tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "aksi tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
