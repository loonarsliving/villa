import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

/**
 * Vercel Cron target (see vercel.json, 1st of every month, 09:15 WITA).
 * Same CRON_SECRET guard as the other cron routes -- once past that, calls
 * villa-api's own POST /cron/sync-mkh-income (guarded separately by
 * integration_settings.cron.secret, same pattern as /cron/dividend-list),
 * which computes last month's rental + walk-in (cafe/spa/lainnya) income via
 * the existing computeReport()/computeWalkinIncome() and pushes it to MKH
 * Property's pendapatan_villa table via a dedicated bridge
 * (integration_settings.mkh_finance_bridge) -- see that repo's migration
 * 0033 / INTEGRATIONS.md for the receiving side. Runs on the 1st of the
 * month so villa-api's default "previous month" periode is the month that
 * just closed; a specific month can still be re-synced by hitting villa-api
 * directly with ?periode=YYYY-MM.
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

    const res = await fetch(`${API_BASE}/cron/sync-mkh-income`, {
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
