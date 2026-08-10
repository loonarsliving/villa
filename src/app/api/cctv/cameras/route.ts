import { NextResponse } from "next/server";
import { requireCctvUser } from "@/lib/cctvGuard";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireCctvUser(request);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { data, error } = await supabaseAdmin().from("cctv_cameras").select("*").order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const guard = await requireCctvUser(request);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.nama !== "string" || typeof body.zona !== "string") {
    return NextResponse.json({ error: "nama and zona are required" }, { status: 400 });
  }
  if (!["security", "front_desk", "housekeeping"].includes(body.zona)) {
    return NextResponse.json({ error: "invalid zona" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("cctv_cameras")
    .insert({
      nama: body.nama,
      zona: body.zona,
      unit_id: body.unit_id || null,
      deskripsi_titik: body.deskripsi_titik || null,
      ezviz_serial: body.ezviz_serial || null,
      ezviz_channel_no: body.ezviz_channel_no || 1,
      ezviz_verification_code: body.ezviz_verification_code || null,
      checkpoint_interval_minutes: body.checkpoint_interval_minutes || 120,
      is_active: body.is_active ?? true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const guard = await requireCctvUser(request);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const { id, ...rest } = body;
  const allowed = [
    "nama",
    "zona",
    "unit_id",
    "deskripsi_titik",
    "ezviz_serial",
    "ezviz_channel_no",
    "ezviz_verification_code",
    "checkpoint_interval_minutes",
    "is_active",
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in rest) patch[key] = rest[key];
  }

  const { data, error } = await supabaseAdmin().from("cctv_cameras").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
