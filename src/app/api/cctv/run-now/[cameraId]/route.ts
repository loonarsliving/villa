import { NextResponse } from "next/server";
import { isAdminToken } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runCheckpointForCamera } from "@/lib/cctvCheckpoint";
import type { CctvCamera } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Manual "run now" for one camera's checkpoint, from the /admin/cctv dashboard. Admin-gated, same as the rest of the CCTV admin surface. */
export async function POST(request: Request, { params }: { params: Promise<{ cameraId: string }> }) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cameraId } = await params;
  const { data: camera, error } = await supabaseAdmin().from("cctv_cameras").select("*").eq("id", cameraId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!camera) return NextResponse.json({ error: "Kamera tidak ditemukan" }, { status: 404 });

  try {
    const result = await runCheckpointForCamera(camera as CctvCamera);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal menjalankan checkpoint" }, { status: 503 });
  }
}
