import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kirimLaporanMingguanInvestor } from "@/lib/investorWeeklyReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Laporan mingguan WhatsApp ke investor (owner 2026-10-07). Vercel Cron
 * tiap Rabu 15:50 WIB (vercel.json `50 8 * * 3`), melaporkan 7 malam
 * Rabu-Selasa sebelumnya. Jamnya dipilih supaya kiriman pertama jatuh di
 * hari owner memintanya. Same CRON_SECRET guard as the other cron routes.
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
    const { pesan, ...ringkas } = await kirimLaporanMingguanInvestor(supabaseAdmin());
    console.log("[investor-weekly-report]", JSON.stringify(ringkas));
    console.log("[investor-weekly-report] pesan:\n" + pesan);
    return NextResponse.json({ ok: true, ...ringkas });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
