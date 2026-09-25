import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refreshPeakCompetitorDataIfStale, type RoomTypeForPricing } from "@/lib/aiPricingEngine";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Riset harga villa tetangga untuk malam puncak (owner-approved
 * 2026-09-24/26). Lihat refreshPeakCompetitorDataIfStale di
 * src/lib/aiPricingEngine.ts.
 *
 * Dijalankan sebagai cron TERSENDIRI, bukan di ujung ai-dynamic-pricing:
 * versi pertama menumpang di sana dengan syarat "run belum lewat 25
 * detik", padahal run harga normal selalu ~34 detik (push, tunggu 4 detik,
 * baca balik, sinkron) -- jadi riset ini tidak pernah sekali pun jalan
 * (log 25 & 26 Sep: "run already took 34s"). Di sini ia punya jatah 60
 * detiknya sendiri dan tidak pernah bisa mengganggu push harga. Ia hanya
 * menulis villa_competitor_rates; mesin harga membacanya mulai run
 * berikutnya.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { data: roomTypes } = await supabase
    .from("villa_room_types")
    .select("id, code, name, description, base_rate, min_rate, max_rate")
    .eq("active", true);

  const summary = await refreshPeakCompetitorDataIfStale(supabase, (roomTypes ?? []) as RoomTypeForPricing[], today);
  console.log("[peak-competitor-research]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
