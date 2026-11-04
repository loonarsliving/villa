import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runElDynamicPricing } from "@/lib/elDynamicPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dynamic pricing Excellent Living tiap malam (pg_cron
 * `villa-ai-dynamic-pricing-el`). Kirim ke Cloudbeds hanya bila saklar
 * auto-push EL menyala; lihat src/lib/elDynamicPricing.ts.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runElDynamicPricing());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/ai-dynamic-pricing-el] gagal", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
