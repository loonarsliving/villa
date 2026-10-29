import { NextResponse } from "next/server";
import { periksaTokenFinance } from "@/lib/villaApiAuth";
import { bacaMutasiBank } from "@/lib/aiBridge";
import { todayISO } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Checklist Dana Masuk: finance mengunggah foto/screenshot/PDF mutasi bank,
 * barisnya disalin AI Mkhsistem, lalu dicocokkan di halaman
 * (src/lib/mutasiBank.ts). File tidak disimpan di mana pun dan tidak ada
 * yang dicatat dari rute ini -- pencatatan tetap lewat tombol finance
 * (/finance/settlements/receive-bulk).
 *
 * Batas body Vercel 4,5 MB: halaman mengecilkan foto lebih dulu, dan PDF
 * dibatasi 3 MB.
 */
const MAKS_BASE64 = 4_200_000;
const MIME_DIIZINKAN = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenFinance(token) : "ditolak";
  if (sesi === "gagal-periksa") {
    return NextResponse.json({ error: "Sesi tidak bisa diperiksa sekarang. Coba lagi sebentar lagi." }, { status: 503 });
  }
  if (sesi !== "lolos") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { dataUrl?: unknown } | null;
  const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m || !MIME_DIIZINKAN.has(m[1].toLowerCase())) {
    return NextResponse.json({ error: "File harus foto (JPG/PNG/WebP) atau PDF." }, { status: 400 });
  }
  if (m[2].length > MAKS_BASE64) {
    return NextResponse.json({ error: "File terlalu besar (maks ±3 MB). Potong per halaman atau kirim screenshot." }, { status: 413 });
  }

  try {
    const hasil = await bacaMutasiBank(m[2], m[1].toLowerCase(), todayISO());
    return NextResponse.json(hasil);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
