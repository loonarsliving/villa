import { NextResponse } from "next/server";
import { periksaTokenChat } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Riwayat satu percakapan, tertua dulu (urutan baca alami).
 *
 * Efek samping yang disengaja: membuka percakapan ini SEKALIGUS
 * menandainya terbaca (unread_count -> 0) -- pola inbox yang wajar
 * (staf membukanya artinya sudah dilihat), dan menghindari perlu
 * endpoint PATCH terpisah cuma untuk itu.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("wa_conversation_messages")
    .select("id,arah,isi,media_url,is_perintah_otomatis,dibalas_oleh,terjemahan,created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("wa_conversations").update({ unread_count: 0 }).eq("id", id);

  return NextResponse.json(data ?? []);
}
