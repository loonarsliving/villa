import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Phase 6 (revenue-engine program): deterministic Revenue Engine.
 *
 * Per the master mandate's explicit architecture (§27/§61): this is the
 * DETERMINISTIC rule engine, not AI -- every number here comes from a
 * fixed formula reading real data, never a model call. It only ever
 * writes `pending_review` rows to villa_pricing_recommendations; nothing
 * here changes a live price. A human approves via the admin UI
 * (/admin/pricing-recommendations), which is the only thing that writes
 * to villa_rates (see that route for the actual price-changing action).
 *
 * Cold start (§28): with near-zero real booking volume today, most/all
 * recommendations will carry confidence='low' -- this is the honest,
 * correct output for this data volume, not a bug. Confidence rises
 * automatically as real booking history accumulates (see
 * computeConfidence below) with no code change needed.
 *
 * Rule (deliberately simple, per §28's "start with deterministic rules"
 * instruction -- not tuned against real data yet, since none exists):
 *   occupancy(room_type, date) >= high_occupancy_threshold_pct
 *     -> recommend +high_occupancy_adjustment_pct
 *   occupancy(room_type, date) <= low_occupancy_threshold_pct
 *     -> recommend low_occupancy_adjustment_pct (negative)
 *   otherwise -> no recommendation generated (nothing to review)
 * Always clamped to the room type's min_rate/max_rate and to
 * max_daily_movement_pct from villa_pricing_settings.
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

function computeConfidence(totalBookingsObserved: number): "low" | "medium" | "high" {
  if (totalBookingsObserved < 20) return "low";
  if (totalBookingsObserved < 100) return "medium";
  return "high";
}

export async function GET(request: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = supabaseAdmin();
    const today = todayJakarta();

    const { data: settingsRows } = await supabase.from("villa_pricing_settings").select("*").eq("active", true).limit(1);
    const settings = settingsRows?.[0];
    if (!settings) {
      return NextResponse.json({ ok: false, error: "villa_pricing_settings has no active row" }, { status: 503 });
    }

    const { data: roomTypes } = await supabase.from("villa_room_types").select("id, code, min_rate, max_rate").eq("active", true);
    if (!roomTypes || roomTypes.length === 0) {
      return NextResponse.json({ ok: true, note: "no active room types", generated: 0 });
    }

    const { data: units } = await supabase.from("units").select("id, room_type_id, tarif_harian");
    const { data: allBookings } = await supabase
      .from("bookings")
      .select("unit_id, tgl_checkin, tgl_checkout, status, created_at")
      .neq("status", "batal");

    const totalBookingsObserved = (allBookings ?? []).length;
    const confidence = computeConfidence(totalBookingsObserved);

    let generated = 0;
    const rows: Array<Record<string, unknown>> = [];

    for (const rt of roomTypes) {
      const unitsOfType = (units ?? []).filter((u) => u.room_type_id === rt.id);
      if (unitsOfType.length === 0) continue;
      const unitIds = new Set(unitsOfType.map((u) => u.id));
      const currentRate = Number(unitsOfType[0].tarif_harian ?? 0);
      if (currentRate <= 0) continue;

      for (let i = 0; i < WINDOW_DAYS; i++) {
        const targetDate = addDays(today, i);

        const activeForDate = (allBookings ?? []).filter(
          (b) =>
            unitIds.has(b.unit_id) &&
            (b.status === "terjadwal" || b.status === "checkin") &&
            b.tgl_checkin <= targetDate &&
            (!b.tgl_checkout || b.tgl_checkout > targetDate),
        );
        const occupancyPct = Math.round((activeForDate.length / unitsOfType.length) * 1000) / 10;

        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        const pickup3d = (allBookings ?? []).filter(
          (b) => unitIds.has(b.unit_id) && b.created_at >= threeDaysAgo && b.tgl_checkin <= targetDate && (!b.tgl_checkout || b.tgl_checkout > targetDate),
        ).length;

        let deltaPct = 0;
        const reasonCodes: string[] = [];
        if (occupancyPct >= Number(settings.high_occupancy_threshold_pct)) {
          deltaPct = Number(settings.high_occupancy_adjustment_pct);
          reasonCodes.push("high_occupancy");
        } else if (occupancyPct <= Number(settings.low_occupancy_threshold_pct)) {
          deltaPct = Number(settings.low_occupancy_adjustment_pct);
          reasonCodes.push("low_occupancy");
        } else {
          continue; // nothing actionable for this date -- no recommendation row
        }
        if (pickup3d > 0) reasonCodes.push("recent_pickup");

        const maxMovement = Number(settings.max_daily_movement_pct);
        let clampedDelta = deltaPct;
        let guardrailStatus: "within_range" | "clamped_min" | "clamped_max" | "clamped_movement" = "within_range";
        if (Math.abs(clampedDelta) > maxMovement) {
          clampedDelta = Math.sign(clampedDelta) * maxMovement;
          guardrailStatus = "clamped_movement";
        }

        let recommendedRate = Math.round(currentRate * (1 + clampedDelta));
        const minRate = rt.min_rate !== null ? Number(rt.min_rate) : null;
        const maxRate = rt.max_rate !== null ? Number(rt.max_rate) : null;
        if (minRate !== null && recommendedRate < minRate) {
          recommendedRate = minRate;
          guardrailStatus = "clamped_min";
        }
        if (maxRate !== null && recommendedRate > maxRate) {
          recommendedRate = maxRate;
          guardrailStatus = "clamped_max";
        }
        if (recommendedRate === currentRate) continue; // guardrails clamped it back to a no-op

        rows.push({
          room_type_id: rt.id,
          target_date: targetDate,
          current_rate: currentRate,
          recommended_rate: recommendedRate,
          delta_pct: Math.round(((recommendedRate - currentRate) / currentRate) * 1000) / 1000,
          reason_codes: reasonCodes,
          confidence,
          guardrail_status: guardrailStatus,
          occupancy_pct: occupancyPct,
          pickup_bookings_3d: pickup3d,
          status: "pending_review",
        });
        generated++;
      }
    }

    // Manual check-then-write rather than a bulk upsert: the uniqueness
    // constraint only applies to status='pending_review' rows (a partial
    // index), which Supabase's upsert() can't target directly. This also
    // makes the intent explicit -- refresh an existing PENDING
    // recommendation for this date if one exists, otherwise insert a new
    // one; never touch a row that's already been approved/rejected/
    // executed for that date.
    for (const row of rows) {
      const { data: existingPending } = await supabase
        .from("villa_pricing_recommendations")
        .select("id")
        .eq("room_type_id", row.room_type_id as string)
        .eq("target_date", row.target_date as string)
        .eq("status", "pending_review")
        .maybeSingle();
      if (existingPending) {
        await supabase.from("villa_pricing_recommendations").update(row).eq("id", existingPending.id);
      } else {
        await supabase.from("villa_pricing_recommendations").insert(row);
      }
    }

    return NextResponse.json({ ok: true, generated, confidence, window_days: WINDOW_DAYS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
