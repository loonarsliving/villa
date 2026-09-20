import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

/**
 * Vercel Cron target (see vercel.json, every 15 min during the night
 * self-checkin window). Thin proxy only -- the actual eligibility check,
 * dedupe, and WA sending live in villa-api's own POST
 * /cron/self-checkin-links, same split as the other WA-sending crons.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { data: setting, error } = await supabaseAdmin().from("integration_settings").select("value").eq("key", "cron").maybeSingle();
    if (error) throw new Error(`Failed to load cron setting: ${error.message}`);
    const cronSecret = (setting?.value as { secret?: string } | undefined)?.secret;
    if (!cronSecret) {
      return NextResponse.json({ error: "integration_settings.cron.secret is not configured" }, { status: 503 });
    }

    const res = await fetch(`${API_BASE}/cron/self-checkin-links`, {
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
