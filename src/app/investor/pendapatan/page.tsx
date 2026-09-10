"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency, currentPeriod, periodLabel } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { Report, OtaBreakdown } from "@/lib/types";

const SUMBER_LABEL: Record<string, string> = {
  "airbnb": "Airbnb",
  "booking.com": "Booking.com",
  "agoda": "Agoda",
  "tiket": "Tiket.com",
  "cloudbeds": "Cloudbeds (OTA lain/belum teridentifikasi)",
  "walk-in": "Walk-in / Langsung",
  "website": "Website Loonars",
  "whatsapp": "WhatsApp",
  "other": "Lainnya",
};

export default function PendapatanPage() {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const [report, setReport] = useState<Report | null>(null);
  const [ota, setOta] = useState<OtaBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!unitId) return;
    Promise.all([
      api.get<Report>(`/report?unit_id=${unitId}&periode=${currentPeriod()}`),
      api.get<OtaBreakdown>(`/report/ota-breakdown?periode=${currentPeriod()}`),
    ])
      .then(([r, o]) => {
        setReport(r);
        setOta(o);
      })
      .finally(() => setLoading(false));
  }, [unitId]);

  const g = report?.gross_revenue || 0;
  const o = report?.opex_per_unit || 0;
  const mk = report?.marketing_amount || 0;
  const gp = report?.net ?? report?.gross_profit ?? 0;
  const ow = report?.owner_amount || 0;
  const lo = report?.pengelola_amount ?? report?.loonars_amount ?? 0;
  const perInvestor = report?.per_investor_amount ?? 0;
  const investorCount = report?.investor_count ?? 0;
  const opexPct = Math.round((report?.opex_pct ?? 0.25) * 100);
  const mkPct = Math.round((report?.marketing_pct ?? 0.275) * 100);

  const rows: [string, number, string, boolean?, boolean?, boolean?][] = [
    ["Pendapatan Seluruh Villa", 100, fmtCurrency(g), false, true],
    [`Opex (${opexPct}% dari omzet)`, Math.round((o / g || 0) * 100), `− ${fmtCurrency(o)}`, true],
    [`Marketing (${mkPct}% dari omzet)`, Math.round((mk / g || 0) * 100), `− ${fmtCurrency(mk)}`, true],
    ["Net Profit", Math.round((gp / g || 0) * 100), fmtCurrency(gp), false, true],
    ["Pool Investor (70%)", 70, fmtCurrency(ow), false, false, true],
    ["Loonars (30%)", 30, fmtCurrency(lo), false],
    [`Bagian Anda (1 dari ${investorCount || "?"} investor, dibagi rata)`, 70, fmtCurrency(perInvestor), false, false, true],
  ];

  return (
    <InvestorShell pageTitle="Pendapatan" pageSub="Alur bagi hasil kolektif seluruh villa">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3.5">
        <StatCard label="Bagian Anda" value={fmtCurrency(perInvestor)} accent="sage" />
        <StatCard label="Gross Revenue" value={fmtCurrency(g)} sub="Seluruh villa" />
        <StatCard label="Opex + Marketing" value={fmtCurrency(o + mk)} sub={`${opexPct}% + ${mkPct}%`} accent="gold" />
        <StatCard label="Net Profit" value={fmtCurrency(gp)} />
      </div>
      <Card>
        <CardHeader title="Alur Bagi Hasil" subtitle={`${periodLabel()} — kolektif, dibagi rata ke semua investor`} />
        {loading ? (
          <Loading />
        ) : (
          rows.map(([lbl, pct, val, isCost, isTot, isGold], i) => (
            <div key={i} className={`flex items-center px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0 text-xs ${isTot ? "bg-gold-500/10" : ""}`}>
              <div className={`flex-1 ${isTot ? "text-ink/80 font-medium" : "text-ink/50"} ${isGold ? "text-gold-500" : ""}`}>{lbl}</div>
              <div className="w-16 sm:w-20 mx-3 h-1 bg-ink/[0.08] rounded-full shrink-0 hidden sm:block">
                <div
                  className={`h-full rounded-full ${isCost ? "bg-ruby-500" : isGold ? "bg-gold-500" : "bg-sage-500"}`}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <div
                className={`font-mono text-[11.5px] font-medium text-right min-w-[100px] ${
                  isGold ? "text-gold-500" : isCost ? "text-ruby-400" : isTot ? "text-ink/80" : "text-ink/50"
                }`}
              >
                {val}
              </div>
            </div>
          ))
        )}
      </Card>

      <Card className="mt-3.5">
        <CardHeader
          title="Rincian Potongan per Platform OTA"
          subtitle={
            ota?.commission_source === "cloudbeds_live"
              ? `${periodLabel()} — persen komisi diambil langsung dari data Cloudbeds`
              : `${periodLabel()} — belum bisa ambil % komisi dari Cloudbeds (key belum aktif)`
          }
        />
        {loading ? (
          <Loading />
        ) : !ota || ota.sources.length === 0 ? (
          <div className="px-4 sm:px-5 py-4 text-[11px] text-ink/40">Belum ada pendapatan tercatat bulan ini.</div>
        ) : (
          <>
            {ota.sources.map((s) => (
              <div key={s.sumber} className="flex items-center px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="text-ink/80">{SUMBER_LABEL[s.sumber] ?? s.sumber}</div>
                  <div className="text-[10px] text-ink/30 mt-0.5">
                    {s.commission_pct > 0 ? `Komisi ${s.commission_pct}%` : "Tanpa komisi (langsung)"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-[11.5px] text-ink/80">{fmtCurrency(s.gross)}</div>
                  {s.commission_amount > 0 && (
                    <div className="font-mono text-[10px] text-ruby-400">− {fmtCurrency(s.commission_amount)}</div>
                  )}
                </div>
              </div>
            ))}
            <div className="flex items-center px-4 sm:px-5 py-3 bg-gold-500/10 text-xs">
              <div className="flex-1 font-medium text-ink/80">Total setelah potongan OTA</div>
              <div className="text-right">
                <div className="font-mono text-[11.5px] font-semibold text-gold-500">{fmtCurrency(ota.total_net)}</div>
                <div className="font-mono text-[10px] text-ink/30">dari {fmtCurrency(ota.total_gross)} kotor</div>
              </div>
            </div>
          </>
        )}
      </Card>
    </InvestorShell>
  );
}
