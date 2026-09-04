import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Phase 4 (revenue-engine program, §7): daily inventory snapshot.
 *
 * Deliberately NOT wired through villa-api -- this is a system cron
 * writing to a new, dedicated table, same direct-service-role pattern
 * already used by the CCTV checkpoint crons and the KTP upload route
 * (src/lib/supabaseAdmin.ts) for functionality that doesn't need
 * villa-api's session/role model.
 *
 * Idempotent: upserts on (snapshot_date, unit_id), so a retried or
 * manually re-triggered run on the same day overwrites that day's rows
 * rather than duplicating them.
 *
 * Uses Asia/Jakarta as the property's business date, per the program's
 * §24 timezone rule -- "today" here is WITA's today, not the server's
 * UTC today, which matters most right around midnight.
 */

function todayInJakarta(): string {
  // en-CA formats as YYYY-MM-DD, which is exactly what a `date` column needs.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
    const snapshotDate = todayInJakarta();

    const { data: units, error: unitsErr } = await supabase.from("units").select("id, status, room_type_id");
    if (unitsErr) throw new Error(`Failed to load units: ${unitsErr.message}`);

    const { data: activeBookings, error: bookingsErr } = await supabase
      .from("bookings")
      .select("unit_id, tgl_checkin, tgl_checkout")
      .in("status", ["terjadwal", "checkin"]);
    if (bookingsErr) throw new Error(`Failed to load bookings: ${bookingsErr.message}`);

    const onBooksUnitIds = new Set(
      (activeBookings ?? [])
        .filter((b) => b.tgl_checkin <= snapshotDate && (!b.tgl_checkout || b.tgl_checkout > snapshotDate))
        .map((b) => b.unit_id),
    );

    const rows = (units ?? []).map((u) => ({
      snapshot_date: snapshotDate,
      unit_id: u.id,
      room_type_id: (u as { room_type_id?: string | null }).room_type_id ?? null,
      unit_status: u.status,
      on_books: onBooksUnitIds.has(u.id),
    }));

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, snapshot_date: snapshotDate, units_snapshotted: 0, note: "no units found" });
    }

    const { error: upsertErr } = await supabase.from("villa_daily_inventory_snapshot").upsert(rows, { onConflict: "snapshot_date,unit_id" });
    if (upsertErr) throw new Error(`Failed to write snapshot: ${upsertErr.message}`);

    const occupied = rows.filter((r) => r.unit_status === "occupied" || r.on_books).length;
    return NextResponse.json({
      ok: true,
      snapshot_date: snapshotDate,
      units_snapshotted: rows.length,
      occupied_or_on_books: occupied,
      occupancy_pct: rows.length > 0 ? Math.round((occupied / rows.length) * 100) : 0,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
