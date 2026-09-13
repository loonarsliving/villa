import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { sendWhatsAppText, isWhacenterConfigured } from "@/lib/whacenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Jalur keluar WhatsApp milik villa sendiri.
 *
 * KONTRAKNYA SENGAJA SAMA PERSIS dengan /api/wa/send milik Mkhsistem --
 * body {phone, message}, header x-internal-secret, balasan {success} --
 * supaya memindahkan villa dari Mkhsistem ke perangkat sendiri cukup
 * dengan mengubah satu nilai: integration_settings.vercel_bridge.base_url.
 * Tidak ada satu baris pun di villa-api yang perlu diubah, dan kalau
 * perangkat baru bermasalah, mengembalikannya juga cukup satu nilai itu.
 */

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = (process.env.VILLA_BRIDGE_SECRET ?? "").trim();
  if (!expected) {
    console.error("[wa/send] VILLA_BRIDGE_SECRET belum dikonfigurasi");
    return NextResponse.json({ success: false, error: "bridge not configured" }, { status: 503 });
  }
  if (!secretsMatch((request.headers.get("x-internal-secret") ?? "").trim(), expected)) {
    console.warn("[wa/send] x-internal-secret tidak cocok");
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isWhacenterConfigured()) {
    return NextResponse.json({ success: false, error: "WHACENTER_DEVICE_ID belum diisi" }, { status: 503 });
  }

  let body: { phone?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "body bukan JSON yang sah" }, { status: 400 });
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!phone || !message) {
    return NextResponse.json({ success: false, error: "phone dan message wajib diisi" }, { status: 400 });
  }
  // 4096 mengikuti batas WhatsApp sendiri, supaya pesan kepanjangan gagal
  // dengan jelas di sini, bukan terpotong diam-diam di hilir.
  if (message.length > 4096) {
    return NextResponse.json({ success: false, error: "pesan melebihi 4096 karakter" }, { status: 400 });
  }

  const result = await sendWhatsAppText(phone, message);
  if (!result.success) {
    console.error("[wa/send] gagal mengirim", result.error);
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
