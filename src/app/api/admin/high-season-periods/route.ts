import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revenue Engine extension (owner request 2026-09-04): CRUD for
 * admin-declared high-season date ranges. The deterministic cron
 * (/api/cron/generate-pricing-recommendations) reads active rows here to
 * decide whether a target_date is high season -- this route never
 * computes a price itself, only stores the ranges an admin defines.
 */

async function requireAdmin(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) return null;
  return token;
}

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.from("villa_high_season_periods").select("*").order("start_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.label || !body?.start_date || !body?.end_date) {
    return NextResponse.json({ error: "label, start_date, end_date wajib diisi" }, { status: 400 });
  }
  if (body.end_date < body.start_date) {
    return NextResponse.json({ error: "end_date tidak boleh sebelum start_date" }, { status: 400 });
  }
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("villa_high_season_periods")
    .insert({
      label: String(body.label).slice(0, 200),
      start_date: body.start_date,
      end_date: body.end_date,
      suggested_adjustment_pct: typeof body.suggested_adjustment_pct === "number" ? body.suggested_adjustment_pct : 0.15,
      active: true,
      created_by: body.created_by ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id wajib diisi" }, { status: 400 });
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.label === "string") update.label = body.label.slice(0, 200);
  if (typeof body.start_date === "string") update.start_date = body.start_date;
  if (typeof body.end_date === "string") update.end_date = body.end_date;
  if (typeof body.suggested_adjustment_pct === "number") update.suggested_adjustment_pct = body.suggested_adjustment_pct;
  if (typeof body.active === "boolean") update.active = body.active;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase.from("villa_high_season_periods").update(update).eq("id", body.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id wajib diisi" }, { status: 400 });
  const supabase = supabaseAdmin();
  const { error } = await supabase.from("villa_high_season_periods").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
