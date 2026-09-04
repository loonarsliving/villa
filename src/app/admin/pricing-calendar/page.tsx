"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { getToken } from "@/lib/api";
import { fmtCurrencyFull } from "@/lib/format";
import { Loading, Card, CardHeader, Badge, Empty } from "@/components/Card";

/**
 * Phase 7 (revenue-engine program): Pricing Calendar -- a room-type x
 * date grid for the next 14 days. Reads /api/admin/pricing-calendar
 * (read-only). Every cell shows the real live rate a guest is charged
 * today (units.tarif_harian), plus a planned villa_rates entry and any
 * pending/executed recommendation for that date when they exist -- no
 * mock data, honest empty state when nothing has been generated/approved
 * yet for a given cell.
 */

interface DayCell {
  date: string;
  live_rate: number | null;
  planned_rate: number | null;
  planned_source: string | null;
  recommendation_status: "pending_review" | "executed" | null;
  recommendation_rate: number | null;
  occupancy_pct: number | null;
  has_snapshot: boolean;
}

interface RoomTypeRow {
  room_type_id: string;
  code: string;
  name: string;
  min_rate: number | null;
  max_rate: number | null;
  unit_count: number;
  current_rate: number | null;
  days: DayCell[];
}

interface CalendarResponse {
  from: string;
  to: string;
  room_types: RoomTypeRow[];
}

function fmtDayLabel(iso: string): { weekday: string; dm: string } {
  const d = new Date(`${iso}T00:00:00`);
  return {
    weekday: d.toLocaleDateString("id-ID", { weekday: "short" }),
    dm: d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" }),
  };
}

export default function PricingCalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    setLoading(true);
    setError(null);
    fetch("/api/admin/pricing-calendar", { headers: token ? { "x-villa-token": token } : {} })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        return body as CalendarResponse;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell pageTitle="Kalender Harga" pageSub="Tarif berjalan, rencana, dan rekomendasi per tipe unit — 14 hari ke depan">
      {loading && <Loading />}
      {!loading && error && (
        <Card>
          <Empty label={`Gagal memuat: ${error}`} />
        </Card>
      )}
      {!loading && !error && data && data.room_types.length === 0 && (
        <Card>
          <Empty label="Belum ada tipe unit aktif." />
        </Card>
      )}
      {!loading && !error && data && data.room_types.length > 0 && (
        <div className="space-y-4">
          {data.room_types.map((rt) => (
            <Card key={rt.room_type_id} className="overflow-x-auto">
              <CardHeader
                title={`${rt.name} (${rt.unit_count} unit)`}
                subtitle={
                  rt.min_rate !== null && rt.max_rate !== null
                    ? `Tarif berjalan ${fmtCurrencyFull(rt.current_rate)} · guardrail ${fmtCurrencyFull(rt.min_rate)}–${fmtCurrencyFull(rt.max_rate)}`
                    : `Tarif berjalan ${fmtCurrencyFull(rt.current_rate)}`
                }
              />
              <div className="p-3 sm:p-4 overflow-x-auto">
                <div className="flex gap-2 min-w-max">
                  {rt.days.map((day) => {
                    const label = fmtDayLabel(day.date);
                    return (
                      <div key={day.date} className="w-[120px] shrink-0 rounded-xl border border-ink/[0.07] p-2.5">
                        <div className="text-[10px] text-ink/40 uppercase tracking-wide mb-1">
                          {label.weekday} · {label.dm}
                        </div>
                        <div className="text-[12.5px] font-medium text-ink mb-1">{fmtCurrencyFull(day.live_rate)}</div>
                        {day.planned_rate !== null && day.planned_rate !== day.live_rate && (
                          <div className="text-[10.5px] text-ink/50 mb-1">
                            rencana: {fmtCurrencyFull(day.planned_rate)}
                            {day.planned_source && day.planned_source !== "manual" ? ` (${day.planned_source})` : ""}
                          </div>
                        )}
                        {day.recommendation_status && (
                          <Badge tone={day.recommendation_status === "executed" ? "ok" : "pending"}>
                            {day.recommendation_status === "executed" ? "disetujui" : "menunggu review"}
                          </Badge>
                        )}
                        <div className="text-[10px] text-ink/35 mt-1.5">
                          {day.has_snapshot ? `Okupansi: ${day.occupancy_pct ?? 0}%` : "Okupansi: belum ada data"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
