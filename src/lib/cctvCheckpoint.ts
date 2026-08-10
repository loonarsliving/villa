import "server-only";

import { supabaseAdmin } from "./supabaseAdmin";
import { captureSnapshot } from "./ezviz";
import { detectPersonInZone } from "./gemini";
import type { CctvCamera } from "./types";

export interface CheckpointRunResult {
  camera_id: string;
  camera_nama: string;
  status: "ok" | "capture_failed" | "ai_failed";
  person_detected: boolean | null;
  error?: string;
}

/**
 * Runs one checkpoint (snapshot + Gemini detection) for a single camera and
 * writes the result row. Shared by the Vercel Cron endpoint (all active
 * cameras, on schedule) and the dashboard's manual "run now" button (one
 * camera, on demand) so both paths log identically.
 */
export async function runCheckpointForCamera(camera: CctvCamera): Promise<CheckpointRunResult> {
  const db = supabaseAdmin();

  if (!camera.ezviz_serial) {
    const row = {
      camera_id: camera.id,
      status: "capture_failed" as const,
      error_detail: "Kamera belum diisi EZVIZ serial number",
    };
    await db.from("cctv_checkpoint_log").insert(row);
    return { camera_id: camera.id, camera_nama: camera.nama, status: "capture_failed", person_detected: null, error: row.error_detail };
  }

  let snapshot;
  try {
    snapshot = await captureSnapshot(camera.ezviz_serial, camera.ezviz_channel_no, camera.ezviz_verification_code);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.from("cctv_checkpoint_log").insert({ camera_id: camera.id, status: "capture_failed", error_detail: error });
    return { camera_id: camera.id, camera_nama: camera.nama, status: "capture_failed", person_detected: null, error };
  }

  try {
    const detection = await detectPersonInZone(snapshot.imageBase64, snapshot.mimeType, camera.zona);
    await db.from("cctv_checkpoint_log").insert({
      camera_id: camera.id,
      status: "ok",
      snapshot_url: snapshot.picUrl,
      person_detected: detection.person_present,
      ai_summary: detection.description,
      ai_raw: detection,
    });
    return { camera_id: camera.id, camera_nama: camera.nama, status: "ok", person_detected: detection.person_present };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.from("cctv_checkpoint_log").insert({
      camera_id: camera.id,
      status: "ai_failed",
      snapshot_url: snapshot.picUrl,
      error_detail: error,
    });
    return { camera_id: camera.id, camera_nama: camera.nama, status: "ai_failed", person_detected: null, error };
  }
}

export async function runCheckpointForAllActiveCameras(): Promise<CheckpointRunResult[]> {
  const db = supabaseAdmin();
  const { data: cameras, error } = await db.from("cctv_cameras").select("*").eq("is_active", true);
  if (error) throw new Error(`Failed to load cctv_cameras: ${error.message}`);

  const results: CheckpointRunResult[] = [];
  for (const camera of (cameras || []) as CctvCamera[]) {
    results.push(await runCheckpointForCamera(camera));
  }
  return results;
}
