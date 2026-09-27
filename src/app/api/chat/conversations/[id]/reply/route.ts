import { NextResponse } from "next/server";
import { periksaTokenStaf } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kirimDariNomorUtama } from "@/lib/mkhsistemWa";
import { catatPesan } from "@/lib/waChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Balasan staf dari halaman Chat Front Desk, dikirim dari nomor utama
 * 082228885223 (perangkat Mkhsistem) -- nomor yang sama dengan tempat
 * tamu mengirim pesan, supaya balasan tidak datang dari nomor asing.
 *
 * Pesan HANYA dicatat ke riwayat kalau benar-benar terkirim -- kalau
 * tidak, layar chat akan menampilkan "terkirim" untuk pesan yang
 * sebenarnya gagal, dan staf tidak tahu harus mengulang.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenStaf(token) : "ditolak";
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
  const isi = typeof body?.message === "string" ? body.message.trim() : "";
  const staffName = typeof body?.staffName === "string" && body.staffName.trim() ? body.staffName.trim() : "Staf";
  if (!isi) return NextResponse.json({ error: "Pesan tidak boleh kosong" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data: percakapan, error: findError } = await supabase
    .from("wa_conversations")
    .select("id,phone")
    .eq("id", id)
    .maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!percakapan) return NextResponse.json({ error: "Percakapan tidak ditemukan" }, { status: 404 });

  const sent = await kirimDariNomorUtama(percakapan.phone, isi);
  if (!sent.success) {
    return NextResponse.json({ error: sent.error ?? "Pesan gagal terkirim ke WhatsApp" }, { status: 502 });
  }

  try {
    await catatPesan(supabase, {
      conversationId: percakapan.id,
      arah: "keluar",
      isi,
      dibalasOleh: staffName,
    });
  } catch (e) {
    // Pesannya SUDAH terkirim ke tamu -- kalau riwayatnya gagal disimpan,
    // itu tetap harus dilaporkan sukses ke staf (jangan sampai dikira
    // gagal dan dikirim ulang, jadi dobel), tapi dicatat di server.
    console.error("[chat/reply] pesan terkirim tapi gagal dicatat", e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json({ success: true });
}
