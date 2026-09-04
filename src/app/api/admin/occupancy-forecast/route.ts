import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 10 (revenue-engine program): occupancy forecast foundation.
 *
 * Deterministic, NOT AI/LLM -- per the mandate's own instruction (§60),
 * "advanced forecasting" only becomes meaningful once real historical
 * data exists, and with near-zero booking history today, an ML/AI
 * forecast would just be noise dressed up as a number. Instead this
 * computes a day-of-week seasonality average from
 * villa_daily_inventory_snapshot (Phase 4): for each of the next 14
 * days, average that same weekday's occupancy over the last 8 weeks of
 * real snapshot data. Every cell that has fewer than
 * MIN_SAMPLES_FOR_FORECAST real observations for that weekday honestly
 * reports null (no forecast) rather than fabricating a number from
 * near-empty history -- this will be the common case at launch and is
 * the correct, honest output, not a bug.
 */

const JAKARTA_TZ = "Asia/Jakarta";
const FORECAST_DAYS = 14;
const LOOKBACK_WEEKS = 8;
const MIN_SAMPLES_FOR_FORECAST = 3;

function fmtDateJakarta(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function todayJakarta(): string {
  return fmtDateJakarta(new Date());
}
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = todayJakarta();
  const historyStart = addDays(today, -7 * LOOKBACK_WEEKS);

  try {
    const supabase = supabaseAdmin();
    const { data: snapshots } = await supabase
      .from("villa_daily_inventory_snapshot")
      .select("snapshot_date, unit_status, on_books")
      .gte("snapshot_date", historyStart)
      .lt("snapshot_date", today);

    const rows = snapshots ?? [];
    const byDate = new Map<string, { total: number; sold: number }>();
    for (const s of rows) {
      const entry = byDate.get(s.snapshot_date) ?? { total: 0, sold: 0 };
      if (s.unit_status !== "maintenance") {
        entry.total++;
        if (s.on_books || s.unit_status === "occupied") entry.sold++;
      }
      byDate.set(s.snapshot_date, entry);
    }
    const dailyOccupancy: { date: string; weekday: number; pct: number }[] = [];
    for (const [date, e] of byDate) {
      if (e.total > 0) dailyOccupancy.push({ date, weekday: weekdayOf(date), pct: (e.sold / e.total) * 100 });
    }

    const forecast = [];
    for (let i = 0; i < FORECAST_DAYS; i++) {
      const targetDate = addDays(today, i);
      const wd = weekdayOf(targetDate);
      const samples = dailyOccupancy.filter((d) => d.weekday === wd);
      const forecastPct =
        samples.length >= MIN_SAMPLES_FOR_FORECAST ? Math.round((samples.reduce((s, d) => s + d.pct, 0) / samples.length) * 10) / 10 : null;
      forecast.push({ date: targetDate, weekday: wd, forecast_occupancy_pct: forecastPct, sample_count: samples.length });
    }

    return NextResponse.json({
      from: today,
      to: addDays(today, FORECAST_DAYS - 1),
      history_days_available: byDate.size,
      min_samples_required: MIN_SAMPLES_FOR_FORECAST,
      forecast,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
