import { NextResponse } from "next/server";
import { runCheckpointForAllActiveCameras } from "@/lib/cctvCheckpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron target (see vercel.json). Vercel automatically sends
 * `Authorization: Bearer $CRON_SECRET` on cron-triggered invocations when a
 * CRON_SECRET env var is set -- unlike Mkhsistem's cron-auth guard, this
 * fails CLOSED on a missing secret since this is a brand-new endpoint with
 * no rollout-compatibility need.
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
    const results = await runCheckpointForAllActiveCameras();
    return NextResponse.json({ ok: true, count: results.length, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
