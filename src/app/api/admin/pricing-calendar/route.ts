import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 7 (revenue-engine program): Pricing Calendar -- a room-type x
 * date grid for the next N days showing the live rate a guest would be
 * charged today (units.tarif_harian, honest current source of truth --
 * see the Phase 6 CHANGES.md scope note, villa_rates is not wired into
 * booking-time pricing yet), any villa_rates row planned for that date,
 * occupancy from villa_daily_inventory_snapshot when available, and
 * whether a pending/executed recommendation exists for that cell. Reuses
 * the same admin-token gating as /api/admin/revenue-metrics. Read-only:
 * writes nothing.
 */

const JAKARTA_TZ = "Asia/Jakarta";
const WINDOW_DAYS = 14;

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

export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = todayJakarta();
  const toDate = addDays(today, WINDOW_DAYS - 1);

  try {
    const supabase = supabaseAdmin();

    const { data: roomTypes } = await supabase
      .from("villa_room_types")
      .select("id, code, name, min_rate, max_rate")
      .eq("active", true)
      .order("code", { ascending: true });

    if (!roomTypes || roomTypes.length === 0) {
      return NextResponse.json({ from: today, to: toDate, room_types: [] });
    }

    const { data: units } = await supabase.from("units").select("id, room_type_id, tarif_harian");
    const { data: rates } = await supabase
      .from("villa_rates")
      .select("room_type_id, date, rate, source")
      .gte("date", today)
      .lte("date", toDate);
    const { data: recs } = await supabase
      .from("villa_pricing_recommendations")
      .select("room_type_id, target_date, status, recommended_rate")
      .gte("target_date", today)
      .lte("target_date", toDate)
      .in("status", ["pending_review", "executed"]);
    const { data: snapshots } = await supabase
      .from("villa_daily_inventory_snapshot")
      .select("unit_id, snapshot_date, unit_status, on_books")
      .gte("snapshot_date", today)
      .lte("snapshot_date", toDate);

    const dates: string[] = [];
    for (let i = 0; i < WINDOW_DAYS; i++) dates.push(addDays(today, i));

    const result = roomTypes.map((rt) => {
      const unitsOfType = (units ?? []).filter((u) => u.room_type_id === rt.id);
      const unitIds = new Set(unitsOfType.map((u) => u.id));
      const currentRate = unitsOfType.length > 0 ? Number(unitsOfType[0].tarif_harian ?? 0) : null;

      const days = dates.map((date) => {
        const plannedRate = (rates ?? []).find((r) => r.room_type_id === rt.id && r.date === date);
        const rec = (recs ?? []).find((r) => r.room_type_id === rt.id && r.target_date === date);
        const snapForDate = (snapshots ?? []).filter((s) => unitIds.has(s.unit_id) && s.snapshot_date === date);
        const occupancyPct =
          snapForDate.length > 0
            ? Math.round((snapForDate.filter((s) => s.on_books || s.unit_status === "occupied").length / snapForDate.length) * 1000) / 10
            : null;
        return {
          date,
          live_rate: currentRate,
          planned_rate: plannedRate ? Number(plannedRate.rate) : null,
          planned_source: plannedRate ? plannedRate.source : null,
          recommendation_status: rec ? rec.status : null,
          recommendation_rate: rec ? Number(rec.recommended_rate) : null,
          occupancy_pct: occupancyPct,
          has_snapshot: snapForDate.length > 0,
        };
      });

      return {
        room_type_id: rt.id,
        code: rt.code,
        name: rt.name,
        min_rate: rt.min_rate !== null ? Number(rt.min_rate) : null,
        max_rate: rt.max_rate !== null ? Number(rt.max_rate) : null,
        unit_count: unitsOfType.length,
        current_rate: currentRate,
        days,
      };
    });

    return NextResponse.json({ from: today, to: toDate, room_types: result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
