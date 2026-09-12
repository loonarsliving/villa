import type { SupabaseClient } from "@supabase/supabase-js";
import { getCloudbedsRoomTypeRate, CloudbedsApiError } from "@/lib/cloudbedsApi";
import { resolveCloudbedsRoomTypeGroups } from "@/lib/cloudbedsRoomTypeMapping";

/**
 * Shared by the daily cron (src/app/api/cron/sync-cloudbeds-rates) and the
 * admin "Sinkron Harga Sekarang" manual trigger
 * (src/app/api/admin/cloudbeds/sync-rates) -- same logic, two entry points
 * with different auth (CRON_SECRET vs isAdminToken). See the cron route's
 * header comment for the owner instruction and design behind this.
 */

const JAKARTA_TZ = "Asia/Jakarta";

/**
 * 90 days, not 14: villa-api prices every night of a booking from
 * villa_rates and only falls back to the flat units.tarif_harian for a
 * night with no row. With a 14-day window, any stay booked further out
 * -- website, front desk, or walk-in -- was silently charged that flat
 * rate instead of the price actually published to the OTAs for those
 * dates. Per owner instruction (2026-09-11) every channel must charge
 * the same published price, so the mirror has to cover the real booking
 * horizon.
 */
export const RATE_SYNC_WINDOW_DAYS = 365;

function fmtDateJakarta(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function todayJakarta(): string {
  return fmtDateJakarta(new Date());
}

export interface RateSyncResult {
  cloudbeds_room_type_id: string;
  villa_room_type_code: string;
  dates_synced: number;
  today_rate: number | null;
  today_rate_clamped: number | null;
  tarif_harian_updated_units: number;
  error?: string;
}

export interface RateSyncSummary {
  ok: true;
  today: string;
  window_days: number;
  room_types_synced: number;
  inconsistent_groups: string[];
  results: RateSyncResult[];
}

export async function syncCloudbedsRates(supabase: SupabaseClient): Promise<RateSyncSummary> {
  const today = todayJakarta();
  const toDate = addDays(today, RATE_SYNC_WINDOW_DAYS - 1);

  const { data: roomTypes } = await supabase.from("villa_room_types").select("id, code, min_rate, max_rate");
  const { villaRoomTypeIdByCloudbedsRoomType, inconsistentGroups } = await resolveCloudbedsRoomTypeGroups(supabase);

  if (villaRoomTypeIdByCloudbedsRoomType.size === 0) {
    return { ok: true, today, window_days: RATE_SYNC_WINDOW_DAYS, room_types_synced: 0, inconsistent_groups: inconsistentGroups, results: [] };
  }

  type RoomTypeRow = { id: string; code: string; min_rate: number | null; max_rate: number | null };
  const roomTypeById = new Map<string, RoomTypeRow>((roomTypes ?? []).map((rt: RoomTypeRow) => [rt.id, rt]));

  const results: RateSyncResult[] = [];

  for (const [cbRoomTypeId, villaRoomTypeId] of villaRoomTypeIdByCloudbedsRoomType) {
    const roomType = roomTypeById.get(villaRoomTypeId);
    if (!roomType) continue;

    let rates: Array<{ date: string; rate: number }>;
    try {
      rates = await getCloudbedsRoomTypeRate(cbRoomTypeId, today, toDate);
    } catch (e) {
      results.push({
        cloudbeds_room_type_id: cbRoomTypeId,
        villa_room_type_code: roomType.code,
        dates_synced: 0,
        today_rate: null,
        today_rate_clamped: null,
        tarif_harian_updated_units: 0,
        error: e instanceof CloudbedsApiError ? e.message : e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // One batched upsert rather than a round trip per date: at 90 days x
    // 2 room types the old select-then-write loop would not finish inside
    // the request time limit. Safe to target this conflict key since
    // 20260911000002 made the constraint NULLS NOT DISTINCT.
    const { error: upsertError } = await supabase.from("villa_rates").upsert(
      rates.map((r) => ({
        room_type_id: villaRoomTypeId,
        rate_plan_id: null,
        date: r.date,
        rate: r.rate,
        source: "cloudbeds_sync",
        reason: "Live rate from Cloudbeds getRate",
        updated_by: "cloudbeds_sync_cron",
      })),
      { onConflict: "room_type_id,rate_plan_id,date" },
    );
    if (upsertError) {
      results.push({
        cloudbeds_room_type_id: cbRoomTypeId,
        villa_room_type_code: roomType.code,
        dates_synced: 0,
        today_rate: null,
        today_rate_clamped: null,
        tarif_harian_updated_units: 0,
        error: `Gagal menyimpan harga: ${upsertError.message}`,
      });
      continue;
    }
    const datesSynced = rates.length;

    const todayRate = rates.find((r) => r.date === today)?.rate ?? null;
    let todayRateClamped = todayRate;
    if (todayRateClamped !== null) {
      const minRate = roomType.min_rate !== null ? Number(roomType.min_rate) : null;
      const maxRate = roomType.max_rate !== null ? Number(roomType.max_rate) : null;
      if (minRate !== null && todayRateClamped < minRate) todayRateClamped = minRate;
      if (maxRate !== null && todayRateClamped > maxRate) todayRateClamped = maxRate;
    }

    let updatedUnits = 0;
    if (todayRateClamped !== null) {
      const { data: updated } = await supabase
        .from("units")
        .update({ tarif_harian: todayRateClamped })
        .eq("room_type_id", villaRoomTypeId)
        .neq("tarif_harian", todayRateClamped)
        .select("id");
      updatedUnits = updated?.length ?? 0;
    }

    results.push({
      cloudbeds_room_type_id: cbRoomTypeId,
      villa_room_type_code: roomType.code,
      dates_synced: datesSynced,
      today_rate: todayRate,
      today_rate_clamped: todayRateClamped,
      tarif_harian_updated_units: updatedUnits,
    });
  }

  return { ok: true, today, window_days: RATE_SYNC_WINDOW_DAYS, room_types_synced: results.length, inconsistent_groups: inconsistentGroups, results };
}
