import { NextResponse } from "next/server";

import { CloudbedsApiError } from "@/lib/cloudbedsApi";
import { KunciElDitolak, syncCloudbedsEl } from "@/lib/elCloudbedsSync";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tombol admin "Sinkron Sekarang" Excellent Living -- jalur yang sama persis dengan cron. */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncCloudbedsEl(supabaseAdmin()));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message, ...(e instanceof KunciElDitolak ? { kunci: e.periksa } : {}) }, { status: e instanceof CloudbedsApiError ? e.status : 502 });
  }
}
