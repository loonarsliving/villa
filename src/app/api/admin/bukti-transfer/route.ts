import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { periksaTokenAdmin } from "@/lib/villaApiAuth";
import { isiBuktiUntuk, kirimBukti, susunDaftarBukti, urlGambar } from "@/lib/buktiTransfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mesin bukti transfer dividen (owner 2026-10-25). GET = daftar investor
 * bulan berjalan + pratinjau bukti; POST {kunci: string[], ulang?: boolean}
 * = kirim bukti ke investor yang dicentang owner. Admin saja.
 *
 * Yang sudah menerima bukti bulan ini dilewati kecuali ulang=true, supaya
 * tombol yang tertekan dua kali tidak membuat bukti dobel.
 */

/**
 * Tautan gambar harus bisa diunduh WhaCenter tanpa login: domain *.vercel.app
 * proyek ini dikunci Vercel SSO ("all_except_custom_domains"), jadi pakai
 * domain produksi kustom (living.haluoleo.id) bila tersedia, bukan domain
 * tempat owner kebetulan membuka halaman ini.
 */
function originPublik(request: Request): string {
  const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  return host ? `https://${host}` : new URL(request.url).origin;
}

async function tolak(request: Request): Promise<NextResponse | null> {
  const token = request.headers.get("x-villa-token") ?? "";
  const hasil = token ? await periksaTokenAdmin(token) : "ditolak";
  if (hasil === "gagal-periksa") return NextResponse.json({ error: "Sesi tidak bisa diperiksa sekarang, coba lagi" }, { status: 503 });
  if (hasil !== "lolos") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export async function GET(request: Request) {
  const ditolak = await tolak(request);
  if (ditolak) return ditolak;
  try {
    const daftar = await susunDaftarBukti(supabaseAdmin());
    const origin = originPublik(request);
    return NextResponse.json({
      ...daftar,
      penerima: daftar.penerima.map((p) => ({ ...p, pratinjau: urlGambar(origin, isiBuktiUntuk(daftar, p)) })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ditolak = await tolak(request);
  if (ditolak) return ditolak;
  const body = (await request.json().catch(() => null)) as { kunci?: unknown; ulang?: unknown } | null;
  const kunci = Array.isArray(body?.kunci) ? body.kunci.filter((k): k is string => typeof k === "string") : [];
  if (!kunci.length) return NextResponse.json({ error: "Pilih minimal satu investor" }, { status: 400 });

  try {
    const supabase = supabaseAdmin();
    const daftar = await susunDaftarBukti(supabase);
    const sudah = new Set(daftar.penerima.filter((p) => p.sudah_dikirim_at).map((p) => p.kunci));
    const dikirim = body?.ulang === true ? kunci : kunci.filter((k) => !sudah.has(k));
    const hasil = await kirimBukti(supabase, daftar, dikirim, originPublik(request));
    return NextResponse.json({
      hasil,
      terkirim: hasil.filter((h) => h.ok).length,
      gagal: hasil.filter((h) => !h.ok).length,
      dilewati_sudah_terkirim: kunci.length - dikirim.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
