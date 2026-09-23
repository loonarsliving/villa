"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtCurrency, fmtCurrencyFull } from "@/lib/format";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { FinanceSurvivalKpis, SurvivalStatus } from "@/lib/types";

/**
 * "Financial control center" top section for /finance.
 *
 * Owner feedback (23 Sep 2026): the first version (all Rupiah, "MKH
 * Operating Result", "Guarantee Gap") was too confusing to hand to
 * staff. Redesigned so the FIRST thing anyone sees is a plain table --
 * kamar/malam vs AMAN or "kurang N malam" -- something a front-desk
 * employee can read without any financial background. The Rupiah-level
 * detail (still useful for Finance/Admin) moved into a collapsed
 * "Detail Finance" section below it, not deleted.
 *
 * IMPORTANT: reads a SEPARATE calculation engine from computeReport()
 * (the frozen, authoritative dividend formula investors are actually
 * paid from). This page never appears on /investor -- owner confirmed
 * (23 Sep 2026) this analysis is Finance-only.
 */

const STATUS_LABEL: Record<SurvivalStatus, string> = {
  SAFE: "AMAN",
  WATCH: "PERLU DIPANTAU",
  AT_RISK: "BERISIKO",
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
  const [showDetail, setShowDetail] = useState(false);

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

  // Rata-rata bulan berjalan (dari tanggal 1 sampai hari ini), BUKAN 30 hari
  // rolling -- per instruksi owner (23 Sep 2026): cek di tanggal 6 harus
  // dibandingkan ke rata-rata tgl 1-6 bulan ini, bukan jendela 30 hari yang
  // bisa nyambung ke bulan lalu.
  const roomsPerNightNow = data.simple.mtd_avg_rooms_per_night;
  const guaranteeCoveragePct = data.investor_guarantee > 0 ? (data.investor_entitlement_mtd / data.investor_guarantee) * 100 : null;
  const gapToGuarantee = data.investor_guarantee - data.investor_entitlement_mtd;

  const statusTone: "ok" | "pending" | "danger" = data.survival_status === "SAFE" ? "ok" : data.survival_status === "WATCH" ? "pending" : "danger";
  const s = data.simple;
  const currentRow = s.target_table.find((r) => roomsPerNightNow != null && Math.round(roomsPerNightNow) === r.rooms_per_night);

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

      {/* ONE-SENTENCE STATUS -- readable by anyone, no financial background needed */}
      <Card className="mb-4">
        <div className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Badge tone={statusTone}>{STATUS_LABEL[data.survival_status]}</Badge>
            <span className="text-[10px] text-ink/40 uppercase tracking-wide">Status Loonars 1</span>
          </div>
          <div className="text-[13px] text-ink/80 leading-relaxed">
            Rata-rata <strong>{fmtRoomsPerNight(roomsPerNightNow)}</strong> (bulan ini sampai hari ini). Supaya AMAN, butuh minimal{" "}
            <strong>{s.required_rooms_per_night != null ? `${s.required_rooms_per_night.toFixed(1)} kamar/malam` : "—"}</strong> rata-rata sebulan.
            {currentRow?.aman === false && currentRow.kurang_malam_per_bulan != null && (
              <>
                {" "}
                Sekarang <strong className="text-ruby-500">kurang {currentRow.kurang_malam_per_bulan} malam terisi</strong> per bulan dari target itu.
              </>
            )}
            {currentRow?.aman === true && <> Target sudah tercapai. ✅</>}
          </div>
        </div>
      </Card>

      {/* SIMPLE TARGET TABLE -- the main thing, kamar/malam vs AMAN atau kurang berapa malam */}
      <Card className="mb-4">
        <CardHeader title="Target Kamar per Malam" subtitle="Aman kalau segini kamar terisi tiap malam rata-rata sebulan" />
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-ink/40 border-b border-ink/10">
                <th className="px-4 py-2">Kamar Terisi / Malam</th>
                <th className="px-3 py-2">Occupancy</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {s.target_table.map((row) => {
                const isCurrent = roomsPerNightNow != null && Math.round(roomsPerNightNow) === row.rooms_per_night;
                return (
                  <tr key={row.rooms_per_night} className={`border-b border-ink/5 ${isCurrent ? "bg-gold-500/[0.08]" : ""}`}>
                    <td className="px-4 py-2.5 font-medium text-ink/80">
                      {row.rooms_per_night} kamar {isCurrent && <span className="text-[9.5px] text-gold-600 font-semibold ml-1">← SEKARANG</span>}
                    </td>
                    <td className="px-3 py-2.5">{fmtPct(row.occupancy_pct, 0)}</td>
                    <td className="px-3 py-2.5">
                      {row.aman ? (
                        <Badge tone="ok">AMAN</Badge>
                      ) : row.kurang_malam_per_bulan != null ? (
                        <span className="text-ruby-500 font-medium">Kurang {row.kurang_malam_per_bulan} malam/bulan</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* THIS MONTH -- how many nights still need to be sold, plain language */}
      <Card className="mb-4">
        <CardHeader title="Bulan Ini" subtitle={`${s.this_month.month} — sisa ${s.this_month.days_remaining} hari`} />
        <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div>
            <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Sudah Terjual</div>
            <div className="font-serif text-lg text-ink">{s.this_month.room_nights_so_far} malam</div>
          </div>
          <div>
            <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Target Sebulan</div>
            <div className="font-serif text-lg text-ink">{s.this_month.room_nights_required != null ? `${Math.ceil(s.this_month.room_nights_required)} malam` : "—"}</div>
          </div>
          <div>
            <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Masih Kurang</div>
            <div className={`font-serif text-lg ${s.this_month.room_nights_still_needed === 0 ? "text-sage-600" : "text-ruby-500"}`}>
              {s.this_month.room_nights_still_needed != null ? `${Math.ceil(s.this_month.room_nights_still_needed)} malam` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[9.5px] text-ink/30 uppercase tracking-wide">Perlu / Malam (Sisa Hari)</div>
            <div className="font-serif text-lg text-ink">
              {s.this_month.avg_rooms_per_night_needed_for_rest_of_month != null
                ? `${s.this_month.avg_rooms_per_night_needed_for_rest_of_month.toFixed(1)} kamar`
                : "—"}
            </div>
          </div>
        </div>
        <div className="px-4 sm:px-5 pb-4 text-[10.5px] text-ink/40">
          Kalau dari {s.this_month.room_nights_still_needed != null ? Math.ceil(s.this_month.room_nights_still_needed) : "—"} malam yang masih kurang itu terjual dari sisa hari bulan ini, target
          tercapai.
        </div>
      </Card>

      {/* Toggle: detailed Rupiah/finance view for Finance/Admin */}
      <button onClick={() => setShowDetail((v) => !v)} className="text-[10.5px] font-semibold text-ink/50 border border-ink/15 rounded px-3 py-1.5 mb-4">
        {showDetail ? "▴ Sembunyikan" : "▾ Lihat"} Detail Finance (Rupiah)
      </button>

      {showDetail && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <StatCard label="30-Day Rolling Occupancy" value={fmtPct(data.rolling_30d.occupancy_pct)} accent="azure" sub={`${data.rolling_30d.days_with_data} hari data`} />
            <StatCard label="Rata-rata Kamar/Malam (Bulan Ini)" value={fmtRoomsPerNight(roomsPerNightNow)} accent={data.rooms_per_night_band.accent} sub={data.rooms_per_night_band.label} />
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

          <Card className="mb-4">
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
        </>
      )}
    </div>
  );
}
