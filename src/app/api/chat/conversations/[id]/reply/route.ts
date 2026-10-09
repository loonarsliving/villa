import { NextResponse } from "next/server";
import { periksaTokenChat } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { terjemahkanChat } from "@/lib/aiBridge";
import { kirimDariNomorUtama } from "@/lib/mkhsistemWa";
import { catatPesan } from "@/lib/waChat";
import { hapusDrafAiAman } from "@/lib/aiResepsionis";

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
  const isi = typeof body?.message === "string" ? body.message.trim() : "";
  const staffName = typeof body?.staffName === "string" && body.staffName.trim() ? body.staffName.trim() : "Staf";
  if (!isi) return NextResponse.json({ error: "Pesan tidak boleh kosong" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data: percakapan, error: findError } = await supabase
    .from("wa_conversations")
    .select("id,phone,bahasa")
    .eq("id", id)
    .maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!percakapan) return NextResponse.json({ error: "Percakapan tidak ditemukan" }, { status: 404 });

  // Tamu berbahasa asing menerima balasan dalam bahasanya; resepsionis tetap
  // menulis dan membaca bahasa Indonesia. Kalau terjemahan gagal, pesan TIDAK
  // dikirim -- lebih baik resepsionis mengulang daripada tamu asing menerima
  // bahasa Indonesia tanpa tahu apa artinya.
  let kirim = isi;
  let terjemahan: string | null = null;
  if (percakapan.bahasa && percakapan.bahasa !== "id") {
    try {
      const hasil = await terjemahkanChat(isi, percakapan.bahasa);
      if (hasil.terjemahan.trim() && hasil.terjemahan.trim() !== isi) {
        kirim = hasil.terjemahan.trim();
        terjemahan = isi;
      }
    } catch (e) {
      console.error("[chat/reply] terjemahan balasan gagal", e instanceof Error ? e.message : String(e));
      return NextResponse.json({ error: "Terjemahan gagal, pesan belum dikirim. Coba kirim ulang." }, { status: 502 });
    }
  }

  const sent = await kirimDariNomorUtama(percakapan.phone, kirim);
  if (!sent.success) {
    return NextResponse.json({ error: sent.error ?? "Pesan gagal terkirim ke WhatsApp" }, { status: 502 });
  }

  try {
    await catatPesan(supabase, {
      conversationId: percakapan.id,
      arah: "keluar",
      isi: kirim,
      terjemahan,
      dibalasOleh: staffName,
    });
  } catch (e) {
    // Pesannya SUDAH terkirim ke tamu -- kalau riwayatnya gagal disimpan,
    // itu tetap harus dilaporkan sukses ke staf (jangan sampai dikira
    // gagal dan dikirim ulang, jadi dobel), tapi dicatat di server.
    console.error("[chat/reply] pesan terkirim tapi gagal dicatat", e instanceof Error ? e.message : String(e));
  }

  // Pesan tamu sudah dijawab staf -- draf AI untuk pesan itu tidak berlaku lagi.
  await hapusDrafAiAman(supabase, percakapan.id);

  return NextResponse.json({ success: true, diterjemahkan: terjemahan !== null });
}
