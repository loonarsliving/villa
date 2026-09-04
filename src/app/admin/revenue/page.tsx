"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { getToken } from "@/lib/api";
import { fmtCurrency } from "@/lib/format";
import { Loading, Card, CardHeader } from "@/components/Card";
import { StatCard } from "@/components/StatCard";

/**
 * Phase 5 (revenue-engine program, §12/§37): the first real hospitality
 * Revenue Dashboard -- occupancy, ADR, RevPAR, bookings, cancellation
 * rate, ALOS, lead time, with a period-over-period comparison. Reads
 * exclusively from /api/admin/revenue-metrics (read-only, computed from
 * the daily inventory snapshot + bookings/transactions) -- no mock data,
 * and this page shows no number it can't actually compute.
 *
 * Deliberately a separate page/nav item from the existing Overview
 * (admin/page.tsx) and from Investor reporting -- per the mandate's
 * explicit instruction that Revenue Management and investor payout stay
 * visually and logically separate, not merged into one screen.
 */

type Period = "today" | "7d" | "30d" | "mtd" | "ytd";

interface Metrics {
  from: string;
  to: string;
  snapshot_days_available: number;
  available_room_nights: number;
  sold_room_nights: number;
  occupancy_pct: number | null;
  room_revenue: number;
  adr: number | null;
  revpar: number | null;
  booking_count: number;
  cancelled_count: number;
  cancellation_rate_pct: number | null;
  alos_nights: number | null;
  avg_lead_time_days: number | null;
}

interface MetricsResponse {
  current: Metrics;
  previous: Metrics;
}

const PERIOD_LABELS: Record<Period, string> = {
  today: "Hari ini",
  "7d": "7 hari",
  "30d": "30 hari",
  mtd: "Bulan ini",
  ytd: "Tahun ini",
};

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}
function fmtNum(v: number | null, suffix = ""): string {
  return v === null ? "—" : `${v}${suffix}`;
}
function delta(cur: number | null, prev: number | null): string | undefined {
  if (cur === null || prev === null) return undefined;
  const d = cur - prev;
  if (d === 0) return "= vs periode sebelumnya";
  const sign = d > 0 ? "+" : "";
  return `${sign}${Math.round(d * 10) / 10} vs periode sebelumnya`;
}

export default function RevenueDashboardPage() {
  const [period, setPeriod] = useState<Period>("mtd");
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/revenue-metrics?period=${period}`, {
      headers: token ? { "x-villa-token": token } : {},
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        return body as MetricsResponse;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [period]);

  const noSnapshotData = data && data.current.snapshot_days_available === 0;

  return (
    <AdminShell pageTitle="Revenue" pageSub="Occupancy, ADR, RevPAR & performa booking">
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition ${
              period === p ? "bg-ink text-base-900 border-ink" : "border-ink/15 text-ink/60 hover:border-ink/30"
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {error && <div className="text-ruby-500 text-xs px-1 py-3">Gagal memuat: {error}</div>}

      {!loading && !error && data && (
        <>
          {noSnapshotData && (
            <Card className="mb-4 border-gold-500/30">
              <div className="p-4 text-[11px] text-ink/60">
                ⚠️ Belum ada data <em>daily inventory snapshot</em> untuk periode ini — Occupancy/ADR/RevPAR akan kosong
                sampai job snapshot harian berjalan beberapa hari (lihat <code>docs/revenue-engine/PHASE4-DESIGN.md</code>).
                Metrik booking (jumlah booking, cancellation rate, ALOS, lead time) tetap akurat karena dihitung langsung
                dari data booking, bukan dari snapshot.
              </div>
            </Card>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard label="Occupancy" value={fmtPct(data.current.occupancy_pct)} accent="azure" sub={delta(data.current.occupancy_pct, data.previous.occupancy_pct)} />
            <StatCard label="ADR" value={fmtCurrency(data.current.adr ?? undefined)} accent="gold" />
            <StatCard label="RevPAR" value={fmtCurrency(data.current.revpar ?? undefined)} accent="sage" />
            <StatCard label="Room Revenue" value={fmtCurrency(data.current.room_revenue)} accent="azure" />
            <StatCard label="Booking" value={String(data.current.booking_count)} sub={delta(data.current.booking_count, data.previous.booking_count)} accent="neutral" />
            <StatCard
              label="Cancellation Rate"
              value={fmtPct(data.current.cancellation_rate_pct)}
              accent={data.current.cancellation_rate_pct && data.current.cancellation_rate_pct > 10 ? "ruby" : "sage"}
            />
            <StatCard label="ALOS" value={fmtNum(data.current.alos_nights, " malam")} accent="neutral" />
            <StatCard label="Lead Time" value={fmtNum(data.current.avg_lead_time_days, " hari")} accent="neutral" />
          </div>

          <Card>
            <CardHeader title="Detail periode" subtitle={`${data.current.from} s/d ${data.current.to}`} />
            <div className="p-4 sm:p-5 text-[11px] text-ink/60 space-y-1.5">
              <div>Available room-nights: <strong className="text-ink/80">{data.current.available_room_nights}</strong></div>
              <div>Sold room-nights: <strong className="text-ink/80">{data.current.sold_room_nights}</strong></div>
              <div>Booking dibatalkan: <strong className="text-ink/80">{data.current.cancelled_count}</strong> dari {data.current.booking_count}</div>
              <div>Snapshot hari tersedia: <strong className="text-ink/80">{data.current.snapshot_days_available}</strong></div>
            </div>
          </Card>
        </>
      )}
    </AdminShell>
  );
}
