import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 5 (revenue-engine program, §12/§37): the first real hospitality
 * revenue metrics this system has ever computed -- occupancy, ADR,
 * RevPAR, booking count, cancellation rate, ALOS, lead time, with a
 * previous-period comparison. Read-only: touches no financial-split
 * logic (computeReport() in villa-api is completely untouched by this
 * route) and mutates nothing.
 *
 * Admin-only, gated the same way as the existing
 * /api/admin/cloudbeds/rooms route: forward the caller's x-villa-token
 * to villa-api's own admin-only /admin/overview rather than
 * re-implementing token verification here.
 *
 * IMPORTANT CAVEAT: occupancy/ADR/RevPAR depend on
 * villa_daily_inventory_snapshot (Phase 4) having rows for the
 * requested period. That table/migration is not applied yet as of this
 * commit, and even once applied, the daily cron only captures data
 * going FORWARD from whenever it starts running -- there is no
 * historical backfill (impossible by design, see PHASE4-DESIGN.md).
 * Until real snapshot data accumulates, this route correctly returns
 * null/0 for those fields rather than fabricating a number, and reports
 * `snapshot_days_available` so a caller can tell the difference between
 * "occupancy is genuinely 0%" and "we don't have snapshot data for this
 * period yet."
 */

const JAKARTA_TZ = "Asia/Jakarta";

function fmtDateJakarta(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function todayJakarta(): string {
  return fmtDateJakarta(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000) + 1;
}

function resolveRange(url: URL): { from: string; to: string } {
  const explicitFrom = url.searchParams.get("from");
  const explicitTo = url.searchParams.get("to");
  if (explicitFrom && explicitTo) return { from: explicitFrom, to: explicitTo };

  const period = url.searchParams.get("period") ?? "mtd";
  const today = todayJakarta();
  if (period === "today") return { from: today, to: today };
  if (period === "7d") return { from: addDays(today, -6), to: today };
  if (period === "30d") return { from: addDays(today, -29), to: today };
  if (period === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  // default: mtd
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

async function computeMetrics(supabase: ReturnType<typeof supabaseAdmin>, from: string, to: string) {
  // Occupancy / ADR / RevPAR -- from the daily inventory snapshot.
  const { data: snapshotRows } = await supabase
    .from("villa_daily_inventory_snapshot")
    .select("snapshot_date, unit_status, on_books")
    .gte("snapshot_date", from)
    .lte("snapshot_date", to);

  const snapshots = snapshotRows ?? [];
  const snapshotDaysAvailable = new Set(snapshots.map((r) => r.snapshot_date)).size;
  const availableRoomNights = snapshots.filter((r) => r.unit_status !== "maintenance").length;
  const soldRoomNights = snapshots.filter((r) => r.on_books || r.unit_status === "occupied").length;
  const occupancyPct = availableRoomNights > 0 ? Math.round((soldRoomNights / availableRoomNights) * 1000) / 10 : null;

  // Room revenue -- transactions.tipe='income' is exactly the same
  // stream computeReport() sums for gross_revenue (villa rental income
  // only; walkin_payments/cafe/spa are a separate stream by design, see
  // PHASE0-BASELINE.md). Filtered by created_at in the Jakarta-bounded
  // range, not periode_bulan, so this works for any date range, not
  // just whole calendar months.
  const rangeStartUtc = `${from}T00:00:00+07:00`;
  const rangeEndUtc = `${addDays(to, 1)}T00:00:00+07:00`;
  const { data: txRows } = await supabase
    .from("transactions")
    .select("jumlah")
    .eq("tipe", "income")
    .gte("created_at", rangeStartUtc)
    .lt("created_at", rangeEndUtc);
  const roomRevenue = (txRows ?? []).reduce((s, t) => s + Number(t.jumlah), 0);

  const adr = soldRoomNights > 0 ? Math.round(roomRevenue / soldRoomNights) : null;
  const revpar = availableRoomNights > 0 ? Math.round(roomRevenue / availableRoomNights) : null;

  // Booking-level metrics -- cohort is every booking whose stay (tgl_checkin)
  // falls in the requested range, any status (so cancellations in-range
  // are counted in the denominator).
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("status, tgl_checkin, tgl_checkout, created_at")
    .gte("tgl_checkin", from)
    .lte("tgl_checkin", to);
  const bookings = bookingRows ?? [];
  const totalBookings = bookings.length;
  const cancelledBookings = bookings.filter((b) => b.status === "batal").length;
  const cancellationRatePct = totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 1000) / 10 : null;

  const activeStays = bookings.filter((b) => b.status !== "batal" && b.tgl_checkout);
  const losValues = activeStays.map((b) => daysBetween(b.tgl_checkin, b.tgl_checkout as string));
  const alosNights = losValues.length > 0 ? Math.round((losValues.reduce((s, v) => s + v, 0) / losValues.length) * 10) / 10 : null;

  const leadTimeValues = activeStays
    .filter((b) => b.created_at)
    .map((b) => daysBetween(fmtDateJakarta(new Date(b.created_at as string)), b.tgl_checkin));
  const avgLeadTimeDays =
    leadTimeValues.length > 0 ? Math.round((leadTimeValues.reduce((s, v) => s + v, 0) / leadTimeValues.length) * 10) / 10 : null;

  return {
    from,
    to,
    snapshot_days_available: snapshotDaysAvailable,
    available_room_nights: availableRoomNights,
    sold_room_nights: soldRoomNights,
    occupancy_pct: occupancyPct,
    room_revenue: roomRevenue,
    adr,
    revpar,
    booking_count: totalBookings,
    cancelled_count: cancelledBookings,
    cancellation_rate_pct: cancellationRatePct,
    alos_nights: alosNights,
    avg_lead_time_days: avgLeadTimeDays,
  };
}

export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const { from, to } = resolveRange(url);

  // Previous period: same length, immediately preceding `from`.
  const rangeDays = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(rangeDays - 1));

  try {
    const supabase = supabaseAdmin();
    const [current, previous] = await Promise.all([computeMetrics(supabase, from, to), computeMetrics(supabase, prevFrom, prevTo)]);
    return NextResponse.json({ current, previous });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
