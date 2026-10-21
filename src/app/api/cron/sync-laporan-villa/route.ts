import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

/**
 * Vercel Cron target (see vercel.json, every night `40 17 * * *` UTC = 00:40 WIB).
 * Same CRON_SECRET guard as the other cron routes -- once past that, calls
 * villa-api's own POST /cron/sync-laporan-villa (guarded separately by
 * integration_settings.cron.secret), which pushes the villa's monthly
 * financial report (kotor, komisi OTA, bersih, COGS, gross profit, OPEX, net
 * profit) to MKH Property's laporan_villa_bulanan via the RPC
 * villa_laporan_terima (same bridge as /cron/sync-mkh-income). The current
 * month goes as 'sementara'; days 1-5 also resend last month so it becomes
 * 'final'. Daily rather than real time on purpose (owner 2026-10-21).
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

    const res = await fetch(`${API_BASE}/cron/sync-laporan-villa`, {
      method: "POST",
      headers: { "x-cron-secret": cronSecret },
    });
    const result = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: result?.error || `HTTP ${res.status}`, result }, { status: 502 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
