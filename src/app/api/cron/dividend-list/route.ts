import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

/**
 * Vercel Cron target (see vercel.json, tanggal 25 tiap bulan jam 09:00 WITA).
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
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
