import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kirimDariNomorUtama } from "@/lib/mkhsistemWa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

/**
 * Vercel Cron target (see vercel.json, tanggal 25 tiap bulan, `0 1 25 * *` UTC = 08:00 WIB).
 * Same CRON_SECRET guard as the other cron routes -- once past that, calls
 * villa-api's own POST /cron/dividend-list (guarded separately by
 * integration_settings.cron.secret, same pattern as its existing
 * /cron/cleaning-calls) so the actual dividend computation + WhatsApp send
 * logic stays in one place (villa-api's computeReport), not duplicated here.
 */
export async function GET(request: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { data: setting, error } = await supabaseAdmin().from("integration_settings").select("value").eq("key", "cron").maybeSingle();
    if (error) throw new Error(`Failed to load cron setting: ${error.message}`);
    const cronSecret = setting?.value?.secret as string | undefined;
    if (!cronSecret) {
      return NextResponse.json({ error: "integration_settings.cron.secret is not configured" }, { status: 503 });
    }

    const res = await fetch(`${API_BASE}/cron/dividend-list`, {
      method: "POST",
      headers: { "x-cron-secret": cronSecret },
    });
    const result = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: result?.error || `HTTP ${res.status}` }, { status: 502 });
    }
    const tautan_bukti = await kirimTautanBuktiTransfer();
    return NextResponse.json({ ok: true, ...result, tautan_bukti });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * Menyusul daftar dividen: tautan ke mesin bukti transfer (/admin/bukti-transfer),
 * tempat owner mencentang investor yang sudah ditransfer supaya buktinya
 * terkirim otomatis (owner 2026-10-25). Gagal di sini tidak menggagalkan cron.
 */
async function kirimTautanBuktiTransfer(): Promise<{ terkirim: number } | { error: string }> {
  const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (!host) return { error: "VERCEL_PROJECT_PRODUCTION_URL tidak tersedia" };
  const { data: admins } = await supabaseAdmin().from("villa_users").select("hp").eq("role", "admin").eq("is_active", true);
  const pesan = `Setelah transfer dividen selesai, buka tautan ini, centang investor yang sudah ditransfer, lalu tekan kirim. Bukti transfer versi Loonars akan terkirim otomatis ke WA masing-masing investor:\n\nhttps://${host}/admin/bukti-transfer`;
  let terkirim = 0;
  for (const a of admins ?? []) {
    const hp = String(a.hp ?? "").replace(/\D/g, "");
    if (hp.length < 8) continue;
    if ((await kirimDariNomorUtama(hp, pesan)).success) terkirim++;
  }
  return { terkirim };
}
