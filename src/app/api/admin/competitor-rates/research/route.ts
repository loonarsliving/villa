import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";
import { researchCompetitorRates } from "@/lib/aiBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Revenue Engine extension (owner request 2026-09-04): admin-triggered AI
 * research of nearby hotel/villa prices (Gemini + Google Search
 * grounding, via Mkhsistem's bridge -- see src/lib/aiBridge.ts and
 * Mkhsistem's app/api/villa/ai/competitor-pricing). Only public,
 * non-confidential info is requested. Results are inserted as
 * villa_competitor_rates rows with source='ai_research' for an admin to
 * review/delete on the dashboard -- nothing here writes to villa_rates
 * or changes a live price directly.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.location_label || !body?.room_type_id) {
    return NextResponse.json({ error: "location_label dan room_type_id wajib diisi" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: roomType, error: rtErr } = await supabase
    .from("villa_room_types")
    .select("id, name, description")
    .eq("id", body.room_type_id)
    .single();
  if (rtErr || !roomType) return NextResponse.json({ error: "Tipe unit tidak ditemukan" }, { status: 404 });

  try {
    const results = await researchCompetitorRates({
      location_label: String(body.location_label).slice(0, 200),
      room_type_name: roomType.name,
      room_type_description: roomType.description ?? "",
    });

    if (results.length === 0) {
      return NextResponse.json({ inserted: 0, results: [] });
    }

    const rows = results.map((r) => ({
      room_type_id: roomType.id,
      location_label: String(body.location_label).slice(0, 200),
      competitor_name: r.competitor_name.slice(0, 200),
      competitor_type: (["hotel", "villa", "other"].includes(r.competitor_type) ? r.competitor_type : "other") as
        | "hotel"
        | "villa"
        | "other",
      price: r.price,
      currency: "IDR",
      source: "ai_research" as const,
      source_note: r.source_note?.slice(0, 500) ?? null,
      observed_at: new Date().toISOString().slice(0, 10),
      created_by: "ai_research",
    }));

    const { data, error } = await supabase.from("villa_competitor_rates").insert(rows).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ inserted: data?.length ?? 0, results: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
