import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revenue Engine extension (owner request 2026-09-04): reference table of
 * observed nearby hotel/villa prices. Rows come either from an admin
 * typing a number in (source='manual') or from the AI research bridge
 * (source='ai_research', see /api/admin/competitor-rates/research) --
 * either way this route only stores/lists/deletes rows; the cron reads
 * them to inform (never overrule) the high-season floor.
 */

async function requireAdmin(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) return null;
  return token;
}

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("villa_competitor_rates")
    .select("*, villa_room_types(code,name)")
    .order("observed_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.location_label || !body?.competitor_name || !body?.competitor_type || typeof body?.price !== "number") {
    return NextResponse.json({ error: "location_label, competitor_name, competitor_type, price wajib diisi" }, { status: 400 });
  }
  if (!["hotel", "villa", "other"].includes(body.competitor_type)) {
    return NextResponse.json({ error: "competitor_type harus hotel, villa, atau other" }, { status: 400 });
  }
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("villa_competitor_rates")
    .insert({
      room_type_id: body.room_type_id ?? null,
      location_label: String(body.location_label).slice(0, 200),
      competitor_name: String(body.competitor_name).slice(0, 200),
      competitor_type: body.competitor_type,
      price: body.price,
      currency: "IDR",
      source: "manual",
      source_note: typeof body.source_note === "string" ? body.source_note.slice(0, 500) : null,
      observed_at: typeof body.observed_at === "string" ? body.observed_at : new Date().toISOString().slice(0, 10),
      created_by: body.created_by ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id wajib diisi" }, { status: 400 });
  const supabase = supabaseAdmin();
  const { error } = await supabase.from("villa_competitor_rates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
