import { NextResponse } from "next/server";
import { tolakJikaBedaProperti } from "@/lib/chatAkses";
import { periksaTokenChat } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hapusDrafAiAman } from "@/lib/aiResepsionis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tutup sesi chat (owner 2026-11-12): urusan tamu selesai -> chat keluar dari
 * daftar aktif, angka belum-dibalas nol di semua perangkat, draf AI dibuang.
 * Pesan penutup ke tamu (opsional) dikirim halaman lewat rute /reply dulu.
 * Sesi terbuka lagi otomatis saat tamu menulis lagi (RPC
 * wa_conversation_increment_unread) atau staf membalas.
 *
 * `lastMessageAt` = waktu pesan terakhir yang dilihat staf (sebelum pesan
 * penutup). Kalau sesudahnya ada pesan MASUK dari tamu, sesi TIDAK ditutup
 * (409) -- pesan itu belum dibaca.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const body = await request.json().catch(() => null);
  const staffName = typeof body?.staffName === "string" && body.staffName.trim() ? body.staffName.trim().slice(0, 80) : "Staf";
  const lastMessageAt = typeof body?.lastMessageAt === "string" ? body.lastMessageAt : "";
  if (!lastMessageAt || Number.isNaN(Date.parse(lastMessageAt))) {
    return NextResponse.json({ error: "lastMessageAt tidak valid" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const pesanMasukBaru = async (): Promise<number | null> => {
    const { count, error } = await supabase
      .from("wa_conversation_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", id)
      .eq("arah", "masuk")
      .gt("created_at", lastMessageAt);
    return error ? null : (count ?? 0);
  };

  const sebelum = await pesanMasukBaru();
  if (sebelum === null) return NextResponse.json({ error: "Gagal memeriksa pesan terbaru" }, { status: 500 });
  if (sebelum > 0) {
    return NextResponse.json({ error: "Ada pesan baru dari tamu. Baca dulu sebelum menutup sesi." }, { status: 409 });
  }

  const ditutupAt = new Date().toISOString();
  const { data: diubah, error } = await supabase
    .from("wa_conversations")
    .update({ ditutup_at: ditutupAt, ditutup_oleh: staffName, unread_count: 0 })
    .eq("id", id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!diubah?.length) return NextResponse.json({ error: "Percakapan tidak ditemukan" }, { status: 404 });

  // Pesan tamu yang masuk tepat di antara pemeriksaan dan update di atas: buka lagi
  // dengan angkanya, supaya pesan itu tidak hilang dari "belum dibalas".
  const sesudah = await pesanMasukBaru();
  if (sesudah && sesudah > 0) {
    await supabase.from("wa_conversations").update({ ditutup_at: null, ditutup_oleh: null, unread_count: sesudah }).eq("id", id);
    return NextResponse.json({ error: "Ada pesan baru dari tamu. Baca dulu sebelum menutup sesi." }, { status: 409 });
  }

  await hapusDrafAiAman(supabase, id);
  return NextResponse.json({ success: true, ditutup_at: ditutupAt, ditutup_oleh: staffName });
}
