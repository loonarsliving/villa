import { after, NextResponse } from "next/server";

import { buatDrafAiAman } from "@/lib/aiResepsionis";
import { secretsMatch } from "@/lib/internalSecret";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bolehMasukResepsionis, catatPesanMasukAman, kirimSapaanPertamaAman, terjemahkanPesanMasukAman } from "@/lib/waChat";
import { normalizeInbound } from "@/lib/whacenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// after() menerjemahkan lalu meminta draf AI (bisa dua panggilan AI + cek ketersediaan).
export const maxDuration = 60;

/**
 * Salinan pesan masuk ke nomor utama 082228885223, diteruskan oleh Mkhsistem.
 *
 * Perangkat WhaCenter nomor itu mengirim webhook ke Mkhsistem, bukan ke
 * villa (dibuktikan dari ai_integration_logs 2026-09-27), dan owner memilih
 * nomor itu tetap jadi nomor chat resepsionis. Mkhsistem meneruskan payload
 * mentah WhaCenter ke sini.
 *
 * Hanya tamu villa dan penanya soal menginap yang dicatat (bolehMasukResepsionis);
 * chat bisnis lain di 0822 dilewati.
 *
 * Jawabannya dibaca Mkhsistem (lib/ai/domains/villa-chat-mirror.ts):
 * `villa: true` berarti percakapan ini milik resepsionis, jadi Mkhsistem tidak
 * membalas dengan AI atau "pilih proyek". Karyawan/kontraktor Mkhsistem sudah
 * disaring di bolehMasukResepsionis, jadi Mkhsistem cukup mengikuti nilai ini.
 *
 * Satu-satunya balasan otomatis ke tamu adalah sapaan pertama, hanya untuk nomor
 * yang baru pertama kali chat DAN belum dikenal sebagai tamu (`!hasil.guestId`).
 * Tanpa syarat kedua ini, tamu yang sudah punya data/booking -- misalnya yang
 * baru saja kita kirimi pengingat check-in -- tetap disapa seolah orang asing
 * begitu dia membalas (kasus nyata 2026-09-28, lihat teksSapaanPertama).
 * Sapaan dikirim lewat after(), setelah Mkhsistem menerima jawaban ini, supaya
 * jalurnya tidak ikut tertahan.
 *
 * Setiap pesan yang tercatat juga dibuatkan DRAF balasan AI (src/lib/aiResepsionis.ts)
 * lewat after(). Draf itu hanya tampil di layar Chat -- tidak ada yang terkirim ke
 * tamu tanpa resepsionis menekan Kirim.
 *
 * HANYA mencatat -- tidak menjalankan LUNAS/PROMO/dll. Perintah-perintah itu
 * sudah diproses Mkhsistem untuk nomor ini; memprosesnya lagi di sini berarti
 * owner menerima balasan konfirmasi dua kali.
 */
export async function POST(request: Request) {
  const expected = (process.env.VILLA_BRIDGE_SECRET ?? "").trim();
  if (!expected) {
    console.error("[wa/mirror] VILLA_BRIDGE_SECRET belum dikonfigurasi");
    return NextResponse.json({ ok: false, error: "bridge not configured" }, { status: 503 });
  }
  if (!secretsMatch((request.headers.get("x-internal-secret") ?? "").trim(), expected)) {
    console.warn("[wa/mirror] x-internal-secret tidak cocok");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const payload: unknown = await request.json().catch(() => null);
  const inbound = normalizeInbound(payload);
  if (!inbound) return NextResponse.json({ ok: true, villa: false, skipped: "bukan pesan perorangan" });

  const supabase = supabaseAdmin();
  if (!(await bolehMasukResepsionis(supabase, inbound.sender, inbound.text))) {
    return NextResponse.json({ ok: true, villa: false, skipped: "bukan tamu atau penanya villa" });
  }

  const hasil = await catatPesanMasukAman(supabase, inbound.sender, inbound.text, {
    namaTampilan: inbound.senderName,
    mediaUrl: inbound.mediaUrl,
  });

  if (hasil) {
    // Terjemahan dulu, baru draf: AI membaca versi Indonesia dari pesan tamu asing.
    after(async () => {
      await terjemahkanPesanMasukAman(supabase, hasil.conversationId, hasil.messageId, inbound.text);
      if (inbound.text.trim()) await buatDrafAiAman(supabase, hasil.conversationId, hasil.messageId);
    });
  }
  if (hasil?.baru && !hasil.guestId) {
    after(() => kirimSapaanPertamaAman(supabase, hasil.conversationId, inbound.sender, inbound.senderName));
  }

  return NextResponse.json({ ok: true, villa: true, tercatat: hasil !== null });
}
