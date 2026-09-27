import { NextResponse } from "next/server";

import { secretsMatch } from "@/lib/internalSecret";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bolehMasukResepsionis, catatPesanMasukAman } from "@/lib/waChat";
import { normalizeInbound } from "@/lib/whacenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!inbound) return NextResponse.json({ ok: true, skipped: "bukan pesan perorangan" });

  const supabase = supabaseAdmin();
  if (!(await bolehMasukResepsionis(supabase, inbound.sender, inbound.text))) {
    return NextResponse.json({ ok: true, skipped: "bukan tamu atau penanya villa" });
  }

  const hasil = await catatPesanMasukAman(supabase, inbound.sender, inbound.text, {
    namaTampilan: inbound.senderName,
    mediaUrl: inbound.mediaUrl,
  });
  return NextResponse.json({ ok: true, tercatat: hasil !== null });
}
