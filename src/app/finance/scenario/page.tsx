"use client";

import { useEffect, useState } from "react";
import { FinanceShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrencyFull } from "@/lib/format";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import type { FinanceScenarioResponse, FinanceScenarioResult, FinanceSurvivalKpis } from "@/lib/types";

/**
 * What-If calculator + 5/6/7/8 rooms/night target table + actual-vs-target
 * comparison. Every number here comes from villa-api's computeScenario(),
 * the SAME pure function that backs the Survival Control Center's target
 * scenarios -- no duplicate arithmetic lives in this page.
 */

const ADR_PRESETS = [400000, 450000, 500000, 550000];
const OCCUPANCY_PRESETS = [10, 20, 30, 40, 50, 60, 70, 80];

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

function ScenarioRow({ label, r, highlight }: { label: string; r: FinanceScenarioResult; highlight?: boolean }) {
  return (
    <tr className={`border-b border-ink/5 ${highlight ? "bg-gold-500/[0.06]" : ""}`}>
      <td className="px-4 py-2.5 font-medium text-ink/80">{label}</td>
      <td className="px-3 py-2.5">{fmtPct(r.occupancy_pct)}</td>
      <td className="px-3 py-2.5">{fmtCurrencyFull(r.net_revenue)}</td>
      <td className="px-3 py-2.5">{fmtCurrencyFull(r.investor_entitlement)}</td>
      <td className="px-3 py-2.5">{fmtCurrencyFull(r.mkh_contractual_share)}</td>
      <td className="px-3 py-2.5">{r.guarantee_gap > 0 ? <span className="text-ruby-500">{fmtCurrencyFull(r.guarantee_gap)}</span> : <Badge tone="ok">Tertutup</Badge>}</td>
      <td className="px-3 py-2.5">{fmtCurrencyFull(r.opex)}</td>
      <td className="px-3 py-2.5">
        <span className={r.mkh_operating_result >= 0 ? "text-sage-600" : "text-ruby-500"}>{fmtCurrencyFull(r.mkh_operating_result)}</span>
      </td>
    </tr>
  );
}

export default function ScenarioPage() {
  const [adr, setAdr] = useState(500000);
  const [adrCustom, setAdrCustom] = useState("");
  const [roomsPerNight, setRoomsPerNight] = useState(2.1);
  const [data, setData] = useState<FinanceScenarioResponse | null>(null);
  const [actual, setActual] = useState<FinanceSurvivalKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const effectiveAdr = adrCustom !== "" ? Number(adrCustom) : adr;

  function load() {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ property: "loonars-1", net_adr: String(effectiveAdr), rooms_per_night: String(roomsPerNight), days: "30" });
    Promise.all([
      api.get<FinanceScenarioResponse>(`/finance/scenario?${qs}`),
      api.get<FinanceSurvivalKpis>(`/finance/survival?property=loonars-1`),
    ])
      .then(([s, a]) => {
        setData(s);
        setActual(a);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [effectiveAdr, roomsPerNight]);

  const occupancyFromRooms = data && data.config.total_rooms > 0 ? (roomsPerNight / data.config.total_rooms) * 100 : null;

  return (
    <FinanceShell pageTitle="What-If / Skenario" pageSub="Kalkulator dan perbandingan target — semua dari mesin hitung yang sama">
      <Card className="mb-4">
        <CardHeader title="What If" subtitle="Ubah ADR dan kamar terjual/malam untuk melihat dampaknya" />
        <div className="p-4 sm:p-5 space-y-4">
          <div>
            <div className="text-[9.5px] font-semibold text-ink/30 tracking-[0.12em] uppercase mb-1.5">Net ADR</div>
            <div className="flex flex-wrap gap-2">
              {ADR_PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setAdr(v);
                    setAdrCustom("");
                  }}
                  className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border ${
                    adrCustom === "" && adr === v ? "bg-ink text-base-900 border-ink" : "border-ink/15 text-ink/60"
                  }`}
                >
                  Rp{(v / 1000).toFixed(0)}rb
                </button>
              ))}
              <input
                className="text-[11px] px-3 py-1.5 rounded-full border border-ink/15 bg-transparent w-32"
                placeholder="Custom (Rp)"
                type="number"
                value={adrCustom}
                onChange={(e) => setAdrCustom(e.target.value)}
              />
            </div>
          </div>

          <div>
            <div className="text-[9.5px] font-semibold text-ink/30 tracking-[0.12em] uppercase mb-1.5">Occupancy (mengatur kamar/malam otomatis)</div>
            <div className="flex flex-wrap gap-2">
              {OCCUPANCY_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => data && setRoomsPerNight(Math.round(((p / 100) * data.config.total_rooms) * 10) / 10)}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-full border border-ink/15 text-ink/60"
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[9.5px] font-semibold text-ink/30 tracking-[0.12em] uppercase mb-1.5">
              Average Rooms Sold / Night {occupancyFromRooms !== null && `(≈ ${occupancyFromRooms.toFixed(1)}% occupancy)`}
            </div>
            <input
              className="text-[13px] px-3 py-2 rounded border border-ink/15 bg-transparent w-40"
              type="number"
              step="0.1"
              value={roomsPerNight}
              onChange={(e) => setRoomsPerNight(Number(e.target.value))}
            />
          </div>
        </div>
      </Card>

      {loading && <Loading />}
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}

      {!loading && !error && data && (
        <>
          <Card className="mb-4">
            <CardHeader title="Hasil Skenario Custom" subtitle={`${roomsPerNight} kamar/malam @ Rp${effectiveAdr.toLocaleString("id-ID")} net ADR`} />
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-ink/40 border-b border-ink/10">
                    <th className="px-4 py-2">Skenario</th>
                    <th className="px-3 py-2">Occupancy</th>
                    <th className="px-3 py-2">Net Revenue</th>
                    <th className="px-3 py-2">Investor 70%</th>
                    <th className="px-3 py-2">MKH 30%</th>
                    <th className="px-3 py-2">Guarantee Gap</th>
                    <th className="px-3 py-2">OPEX</th>
                    <th className="px-3 py-2">MKH Result</th>
                  </tr>
                </thead>
                <tbody>
                  <ScenarioRow label="Custom" r={data.custom} highlight />
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mb-4">
            <CardHeader title="Actual vs Target" subtitle={`Net ADR target Rp${data.config.target_net_adr.toLocaleString("id-ID")}`} />
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-ink/40 border-b border-ink/10">
                    <th className="px-4 py-2">Skenario</th>
                    <th className="px-3 py-2">Occupancy</th>
                    <th className="px-3 py-2">Net Revenue</th>
                    <th className="px-3 py-2">Investor 70%</th>
                    <th className="px-3 py-2">MKH 30%</th>
                    <th className="px-3 py-2">Guarantee Gap</th>
                    <th className="px-3 py-2">OPEX</th>
                    <th className="px-3 py-2">MKH Result</th>
                  </tr>
                </thead>
                <tbody>
                  {actual && (
                    <tr className="border-b border-ink/5 bg-azure-500/[0.06]">
                      <td className="px-4 py-2.5 font-medium text-ink/80">Actual (30 hari terakhir)</td>
                      <td className="px-3 py-2.5">{fmtPct(actual.rolling_30d.occupancy_pct)}</td>
                      <td className="px-3 py-2.5">{fmtCurrencyFull(actual.net_revenue_mtd)}</td>
                      <td className="px-3 py-2.5">{fmtCurrencyFull(actual.investor_entitlement_mtd)}</td>
                      <td className="px-3 py-2.5">{fmtCurrencyFull(actual.mkh_contractual_share_mtd)}</td>
                      <td className="px-3 py-2.5">
                        {actual.guarantee_gap > 0 ? <span className="text-ruby-500">{fmtCurrencyFull(actual.guarantee_gap)}</span> : <Badge tone="ok">Tertutup</Badge>}
                      </td>
                      <td className="px-3 py-2.5">{fmtCurrencyFull(actual.opex_mtd)}</td>
                      <td className="px-3 py-2.5">
                        <span className={actual.mkh_operating_result >= 0 ? "text-sage-600" : "text-ruby-500"}>{fmtCurrencyFull(actual.mkh_operating_result)}</span>
                      </td>
                    </tr>
                  )}
                  {data.targets.map((t) => (
                    <ScenarioRow
                      key={t.rooms_per_night}
                      label={`Target: ${t.rooms_per_night} kamar/malam${t.rooms_per_night === 5 ? " (survival)" : t.rooms_per_night === 7 ? " (aman)" : ""}`}
                      r={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
