import { NextResponse } from "next/server";
import { periksaTokenChat } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAHASA_RE = /^[a-z]{2,3}$/;

/**
 * Resepsionis membetulkan bahasa tamu kalau tebakan otomatis keliru.
 * `bahasa: "id"` = tanpa terjemahan; kode lain = balasan diterjemahkan ke sana.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenChat(token) : "ditolak";
  if (sesi === "gagal-periksa") {
    return NextResponse.json(
      { error: "Sesi tidak bisa diperiksa sekarang — jaringan atau villa-api sedang terganggu. Coba lagi sebentar lagi." },
      { status: 503 },
    );
  }
  if (sesi !== "lolos") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id percakapan tidak valid" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const bahasa = typeof body?.bahasa === "string" ? body.bahasa.trim().toLowerCase() : "";
  if (!BAHASA_RE.test(bahasa)) return NextResponse.json({ error: "Kode bahasa tidak valid" }, { status: 400 });

  const { error } = await supabaseAdmin().from("wa_conversations").update({ bahasa }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, bahasa });
}
