import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { kirimPengumumanInvestor } from "@/lib/investorPengumuman";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pengumuman WhatsApp sekali kirim ke investor (owner 2026-11-08), jalur yang
 * sama dengan laporan mingguan. Dipicu Vercel Cron (vercel.json) atau manual
 * dengan rahasia cron; `?dry=1` hanya menghitung penerima. Pengamannya ada di
 * kirimPengumumanInvestor: satu nomor sekali per pengumuman, dan tidak
 * mengirim apa pun setelah masa berlakunya.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  try {
    const hasil = await kirimPengumumanInvestor(supabaseAdmin(), { dryRun });
    console.log("[investor-pengumuman]", JSON.stringify({ ...hasil, nama_penerima: hasil.nama_penerima.length }));
    return NextResponse.json({ ok: true, ...hasil });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
