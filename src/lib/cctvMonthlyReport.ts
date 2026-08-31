import "server-only";

import { supabaseAdmin } from "./supabaseAdmin";
import type { CctvCamera, CctvCheckpointLog } from "./types";

export interface MonthlyReportResult {
  camera_id: string;
  camera_nama: string;
  total_checkpoints: number;
  total_absent: number;
  report_id: string | null;
  skipped?: "no_checkpoints";
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregates last month's cctv_checkpoint_log rows into one
 * cctv_disciplinary_reports row per camera -- the AI never issues a
 * disciplinary verdict on its own; this only compiles the raw record
 * (which checkpoints found nobody present) for an admin to review and
 * confirm/dismiss (see villa-api's /admin/cctv/disciplinary-reports PATCH).
 * Defaults to the calendar month before `now` (intended to run on the 1st,
 * see vercel.json's cctv-monthly-report cron) -- pass an explicit `now` only
 * for a manual/backfill run.
 */
export async function generateMonthlyReports(now: Date = new Date()): Promise<MonthlyReportResult[]> {
  const db = supabaseAdmin();

  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodStart = new Date(Date.UTC(firstOfThisMonth.getUTCFullYear(), firstOfThisMonth.getUTCMonth() - 1, 1));
  const periodEnd = new Date(firstOfThisMonth.getTime() - 1); // last instant of previous month
  const periodStartStr = ymd(periodStart);
  const periodEndStr = ymd(periodEnd);

  const { data: cameras, error: camerasError } = await db.from("cctv_cameras").select("*").not("zona", "is", null);
  if (camerasError) throw new Error(`Failed to load cctv_cameras: ${camerasError.message}`);

  const results: MonthlyReportResult[] = [];
  for (const camera of (cameras || []) as CctvCamera[]) {
    const { data: logs, error: logsError } = await db
      .from("cctv_checkpoint_log")
      .select("*")
      .eq("camera_id", camera.id)
      .eq("status", "ok")
      .gte("captured_at", periodStart.toISOString())
      .lt("captured_at", firstOfThisMonth.toISOString())
      .order("captured_at", { ascending: true });
    if (logsError) throw new Error(`Failed to load cctv_checkpoint_log for ${camera.id}: ${logsError.message}`);

    const rows = (logs || []) as CctvCheckpointLog[];
    if (rows.length === 0) {
      results.push({ camera_id: camera.id, camera_nama: camera.nama, total_checkpoints: 0, total_absent: 0, report_id: null, skipped: "no_checkpoints" });
      continue;
    }

    const absentRows = rows.filter((r) => r.person_detected === false);
    const totalPresent = rows.filter((r) => r.person_detected === true).length;

    // Never overwrite a report an admin has already reviewed (confirmed/
    // dismissed) -- a re-run of this job (retry, or a later manual backfill
    // for the same month) must not silently reset their decision back to
    // pending_review and wipe reviewed_by/reviewed_at/review_note.
    const { data: existing } = await db
      .from("cctv_disciplinary_reports")
      .select("id, status")
      .eq("camera_id", camera.id)
      .eq("period_start", periodStartStr)
      .maybeSingle();
    if (existing && existing.status !== "pending_review") {
      results.push({ camera_id: camera.id, camera_nama: camera.nama, total_checkpoints: rows.length, total_absent: absentRows.length, report_id: existing.id });
      continue;
    }

    const { data: report, error: upsertError } = await db
      .from("cctv_disciplinary_reports")
      .upsert(
        {
          camera_id: camera.id,
          period_start: periodStartStr,
          period_end: periodEndStr,
          total_checkpoints: rows.length,
          total_present: totalPresent,
          total_absent: absentRows.length,
          absence_details: absentRows.map((r) => ({ captured_at: r.captured_at, ai_summary: r.ai_summary })),
          status: "pending_review",
          generated_at: new Date().toISOString(),
        },
        { onConflict: "camera_id,period_start" }
      )
      .select("id")
      .single();
    if (upsertError) throw new Error(`Failed to upsert cctv_disciplinary_reports for ${camera.id}: ${upsertError.message}`);

    results.push({ camera_id: camera.id, camera_nama: camera.nama, total_checkpoints: rows.length, total_absent: absentRows.length, report_id: report.id });
  }
  return results;
}
