import { NextResponse } from "next/server";
import { tolakJikaBedaProperti } from "@/lib/chatAkses";
import { periksaTokenChat } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Riwayat satu percakapan, tertua dulu (urutan baca alami).
 *
 * Membuka percakapan TIDAK lagi menolkan unread_count (2026-11-12): angka itu
 * kini "pesan tamu belum dibalas", dinolkan hanya saat staf membalas atau
 * menutup sesi -- supaya perangkat lain tetap melihat chat yang belum
 * dibalas. Status "sudah dilihat" disimpan per perangkat
 * (src/lib/chatPerangkat.ts).
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
  const bedaProperti = await tolakJikaBedaProperti(request, token, id);
  if (bedaProperti) return bedaProperti;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id percakapan tidak valid" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("wa_conversation_messages")
    .select("id,arah,isi,media_url,is_perintah_otomatis,dibalas_oleh,terjemahan,created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
