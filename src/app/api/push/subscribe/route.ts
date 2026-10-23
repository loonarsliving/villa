import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PERAN_NOTIF_CHAT_TAMU } from "@/lib/webPushConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VILLA_API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

/**
 * Mendaftarkan perangkat (browser / iPhone layar utama) untuk notifikasi
 * chat tamu (owner 2026-10-23). Peran diambil dari villa-api
 * `/manager/whoami` -- BUKAN dari isi permintaan -- dan hanya peran
 * penerima (`manager`, Rebecca) yang disimpan. Admin juga lolos whoami
 * (boleh membuka /manager) tapi owner memilih "Rebecca saja", jadi tidak
 * disimpan.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let role: string | null = null;
  try {
    const res = await fetch(`${VILLA_API_BASE}/manager/whoami`, {
      headers: { "x-villa-token": token },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 500) return NextResponse.json({ error: "Sesi tidak bisa diperiksa sekarang. Coba lagi sebentar lagi." }, { status: 503 });
    if (!res.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await res.json().catch(() => null)) as { role?: unknown } | null;
    role = typeof body?.role === "string" ? body.role : null;
  } catch {
    return NextResponse.json({ error: "Sesi tidak bisa diperiksa sekarang. Coba lagi sebentar lagi." }, { status: 503 });
  }

  if (role !== PERAN_NOTIF_CHAT_TAMU) {
    return NextResponse.json({ ok: true, aktif: false, alasan: "Notifikasi chat tamu hanya untuk akun manager." });
  }

  const body = (await request.json().catch(() => null)) as {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  } | null;
  const endpoint = typeof body?.subscription?.endpoint === "string" ? body.subscription.endpoint : "";
  const p256dh = typeof body?.subscription?.keys?.p256dh === "string" ? body.subscription.keys.p256dh : "";
  const auth = typeof body?.subscription?.keys?.auth === "string" ? body.subscription.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) {
    return NextResponse.json({ error: "Data langganan tidak valid" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { error } = await supabase.from("villa_push_subscriptions").upsert(
    {
      role,
      endpoint,
      p256dh,
      auth_key: auth,
      user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, aktif: true });
}
