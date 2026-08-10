import { NextResponse } from "next/server";
import { requireCctvUser } from "@/lib/cctvGuard";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runCheckpointForCamera } from "@/lib/cctvCheckpoint";
import type { CctvCamera } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ cameraId: string }> }) {
  const guard = await requireCctvUser(request);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { cameraId } = await params;
  const { data: camera, error } = await supabaseAdmin().from("cctv_cameras").select("*").eq("id", cameraId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!camera) return NextResponse.json({ error: "camera not found" }, { status: 404 });

  const result = await runCheckpointForCamera(camera as CctvCamera);
  return NextResponse.json(result);
}
