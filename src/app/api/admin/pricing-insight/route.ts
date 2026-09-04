import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";
import { explainPricingRecommendation } from "@/lib/aiBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Phase 8 (revenue-engine program): on-demand "AI Insight" for one
 * pricing recommendation -- loads the recommendation's own numbers
 * (already computed by the Phase 6 rule engine) and asks Mkhsistem's AI
 * Service to phrase a short explanation. Never persisted, never
 * influences the recommendation itself -- purely for the admin to read
 * before approving/rejecting on /admin/pricing-recommendations.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id wajib diisi" }, { status: 400 });
  }

  try {
    const supabase = supabaseAdmin();
    const { data: rec, error } = await supabase
      .from("villa_pricing_recommendations")
      .select("*, villa_room_types(name)")
      .eq("id", id)
      .single();
    if (error || !rec) {
      return NextResponse.json({ error: "Rekomendasi tidak ditemukan" }, { status: 404 });
    }

    const insight = await explainPricingRecommendation({
      room_type_name: rec.villa_room_types?.name ?? "-",
      target_date: rec.target_date,
      current_rate: Number(rec.current_rate),
      recommended_rate: Number(rec.recommended_rate),
      delta_pct: Number(rec.delta_pct),
      reason_codes: rec.reason_codes ?? [],
      guardrail_status: rec.guardrail_status,
      occupancy_pct: rec.occupancy_pct !== null ? Number(rec.occupancy_pct) : null,
      pickup_bookings_3d: rec.pickup_bookings_3d,
      confidence: rec.confidence,
    });

    return NextResponse.json({ insight });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
