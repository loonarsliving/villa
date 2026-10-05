import { NextResponse } from "next/server";
import { ambilDrafAi } from "@/lib/aiResepsionis";
import { periksaTokenStaf } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Draf balasan AI untuk satu percakapan (lihat src/lib/aiResepsionis.ts).
 * `null` kalau tidak ada draf, drafnya sudah basi, atau kolomnya belum ada --
 * layar Chat cukup tidak menampilkan apa-apa, tidak perlu galat.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenStaf(token) : "ditolak";
  if (sesi === "gagal-periksa") {
    return NextResponse.json({ error: "Sesi tidak bisa diperiksa sekarang. Coba lagi sebentar lagi." }, { status: 503 });
  }
  if (sesi !== "lolos") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id percakapan tidak valid" }, { status: 400 });

  return NextResponse.json(await ambilDrafAi(supabaseAdmin(), id));
}
