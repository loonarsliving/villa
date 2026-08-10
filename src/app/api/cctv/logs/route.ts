import { NextResponse } from "next/server";
import { requireCctvUser } from "@/lib/cctvGuard";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireCctvUser(request);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(request.url);
  const cameraId = url.searchParams.get("camera_id");
  const limit = Math.min(Number(url.searchParams.get("limit") || "100"), 500);

  let query = supabaseAdmin().from("cctv_checkpoint_log").select("*").order("captured_at", { ascending: false }).limit(limit);
  if (cameraId) query = query.eq("camera_id", cameraId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
