"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtCurrency, fmtCurrencyFull } from "@/lib/format";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { FinanceSurvivalKpis, SurvivalStatus } from "@/lib/types";

/**
 * "Financial control center" top section for /finance -- answers, within
 * a few seconds of opening the page, whether Loonars 1 can currently
 * cover its investor guarantee and OPEX from actual bookings.
 *
 * IMPORTANT: this reads a SEPARATE calculation engine from
 * computeReport() (the frozen, authoritative dividend formula investors
 * are actually paid from -- see villa-api's module comment above
 * computeSurvivalKpis()). This page never appears on /investor; the
 * owner explicitly confirmed (23 Sep 2026) this analysis is Finance-only.
 */

const STATUS_LABEL: Record<SurvivalStatus, string> = {
  SAFE: "AMAN",
  WATCH: "PERLU DIPANTAU",
  AT_RISK: "BERISIKO",
};
const STATUS_DESC: Record<SurvivalStatus, string> = {
  SAFE: "Revenue net saat ini cukup menutupi jaminan investor DAN OPEX dari pembagian kontraktual 70/30.",
  WATCH: "Masih ada gap ke jaminan investor, tapi MKH masih bisa menutupinya dari porsi 30%-nya sendiri tanpa perlu dana tambahan dari luar.",
  AT_RISK: "Gap ke jaminan investor dan/atau OPEX terlalu besar untuk ditutup dari porsi MKH sendiri -- butuh dana tambahan.",
};

function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null ? "—" : `${v.toFixed(digits)}%`;
}
function fmtRoomsPerNight(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toFixed(1)} kamar/malam`;
}

export function SurvivalControlCenter({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<FinanceSurvivalKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<FinanceSurvivalKpis>(`/finance/survival?property=loonars-1&from=${from}&to=${to}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  if (loading) return <Loading label="Memuat posisi Loonars 1..." />;
  if (error) return <div className="text-ruby-500 text-xs px-1 py-3 mb-4">Gagal memuat Survival Control Center: {error}</div>;
  if (!data) return null;

  const guaranteeCoveragePct = data.investor_guarantee > 0 ? (data.investor_entitlement_mtd / data.investor_guarantee) * 100 : null;
  const roomsPerNightNow = data.rolling_30d.rooms_per_night ?? data.rooms_per_night_period;
  const gapTo5 = roomsPerNightNow != null ? 5 - roomsPerNightNow : null;
  const gapToGuarantee = data.investor_guarantee - data.investor_entitlement_mtd;

  const statusTone: "ok" | "pending" | "danger" = data.survival_status === "SAFE" ? "ok" : data.survival_status === "WATCH" ? "pending" : "danger";
  const statusAccent = data.survival_status === "SAFE" ? "sage" : data.survival_status === "WATCH" ? "gold" : "ruby";

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-serif text-lg text-ink">{data.property_name} — Posisi Hari Ini</div>
          <div className="text-[10px] text-ink/40">
            Hari ini: {data.today.date} · {data.today.occupied}/{data.today.available} kamar terisi
            {data.today.occupancy_pct != null ? ` (${fmtPct(data.today.occupancy_pct)})` : ""}
            {!data.today.has_snapshot && " — belum ada snapshot hari ini"}
          </div>
        </div>
        <Link href="/finance/scenario" className="text-[10px] font-semibold text-ink/50 border border-ink/15 rounded px-2.5 py-1.5 shrink-0">
          What-If / Skenario →
        </Link>
      </div>

      {/* LOONARS 1 SURVIVAL STATUS -- the big card */}
      <Card className="mb-4">
        <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center shrink-0 text-2xl font-serif ${
            statusAccent === "sage" ? "bg-sage-500/15 text-sage-600" : statusAccent === "gold" ? "bg-gold-500/15 text-gold-600" : "bg-ruby-500/15 text-ruby-600"
          }`}>
            {data.survival_status === "SAFE" ? "✓" : data.survival_status === "WATCH" ? "!" : "✕"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold text-ink/40 tracking-wide uppercase mb-1">Loonars 1 Survival Status</div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-serif text-xl text-ink">{STATUS_LABEL[data.survival_status]}</span>
              <Badge tone={statusTone}>{data.survival_status}</Badge>
            </div>
            <div className="text-[11px] text-ink/60">{STATUS_DESC[data.survival_status]}</div>
          </div>
        </div>
      </Card>

      {/* Top KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard label="30-Day Rolling Occupancy" value={fmtPct(data.rolling_30d.occupancy_pct)} accent="azure" sub={`${data.rolling_30d.days_with_data} hari data`} />
        <StatCard label="Rata-rata Kamar/Malam" value={fmtRoomsPerNight(roomsPerNightNow)} accent={data.rooms_per_night_band.accent} sub={data.rooms_per_night_band.label} />
        <StatCard label="Net ADR" value={data.net_adr != null ? fmtCurrency(data.net_adr) : "—"} accent="azure" sub={data.net_adr == null ? "Belum ada kamar terisi" : undefined} />
        <StatCard label="Net Revenue (periode)" value={fmtCurrency(data.net_revenue_mtd)} accent="azure" />
        <StatCard label="Jaminan Investor" value={fmtCurrency(data.investor_guarantee)} accent="neutral" sub="per bulan" />
        <StatCard
          label="Cakupan Jaminan"
          value={fmtPct(guaranteeCoveragePct, 0)}
          accent={guaranteeCoveragePct != null && guaranteeCoveragePct >= 100 ? "sage" : "gold"}
          sub={`Entitlement ${fmtCurrency(data.investor_entitlement_mtd)}`}
        />
        <StatCard label="OPEX (periode)" value={fmtCurrency(data.opex_mtd)} accent="neutral" sub="asumsi payroll + listrik" />
        <StatCard
          label="MKH Operating Result"
          value={fmtCurrency(data.mkh_operating_result)}
          accent={data.mkh_operating_result >= 0 ? "sage" : "ruby"}
          sub={data.mkh_funding_gap > 0 ? `Butuh dana tambahan ${fmtCurrency(data.mkh_funding_gap)}` : undefined}
        />
      </div>

      {/* Gap callouts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Card>
          <CardHeader title="Seberapa jauh dari 5 kamar/malam?" subtitle="Target survival" />
          <div className="p-4 sm:p-5 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Sekarang</div>
              <div className="font-serif text-lg text-ink">{roomsPerNightNow != null ? roomsPerNightNow.toFixed(1) : "—"}</div>
            </div>
            <div>
              <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Target</div>
              <div className="font-serif text-lg text-ink">5.0</div>
            </div>
            <div>
              <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Gap</div>
              <div className={`font-serif text-lg ${gapTo5 != null && gapTo5 <= 0 ? "text-sage-600" : "text-ruby-500"}`}>
                {gapTo5 == null ? "—" : gapTo5 <= 0 ? "Tercapai" : `+${gapTo5.toFixed(1)}`}
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Seberapa jauh dari cakupan jaminan?" subtitle="Periode berjalan" />
          <div className="p-4 sm:p-5 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Entitlement</div>
              <div className="font-serif text-base text-ink">{fmtCurrency(data.investor_entitlement_mtd)}</div>
            </div>
            <div>
              <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Jaminan</div>
              <div className="font-serif text-base text-ink">{fmtCurrency(data.investor_guarantee)}</div>
            </div>
            <div>
              <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Gap</div>
              <div className={`font-serif text-base ${gapToGuarantee <= 0 ? "text-sage-600" : "text-ruby-500"}`}>
                {gapToGuarantee <= 0 ? "Tercapai" : fmtCurrency(gapToGuarantee)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {data.additional_revenue_needed > 0 && (
        <Card className="mb-4 border-gold-500/30">
          <div className="p-4 text-[11px] text-ink/60">
            💡 Butuh tambahan revenue net sekitar <strong className="text-ink/80">{fmtCurrencyFull(data.additional_revenue_needed)}</strong> pada
            periode ini supaya jaminan investor dan OPEX bisa tertutup penuh dari pembagian kontraktual 70/30.
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Catatan perhitungan" />
        <div className="p-4 sm:p-5 text-[10.5px] text-ink/50 space-y-1">
          <div>• {data.net_adr_note}</div>
          <div>• {data.opex_note}</div>
          <div>
            • Formula entitlement/jaminan di sini TERPISAH dari perhitungan bagi hasil investor aktual (lihat halaman Investor) --
            khusus untuk analisis Finance, tidak dipakai membayar dividen.
          </div>
        </div>
      </Card>
    </div>
  );
}
