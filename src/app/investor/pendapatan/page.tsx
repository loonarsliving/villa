"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency, currentPeriod, periodLabel } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { Report } from "@/lib/types";

export default function PendapatanPage() {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const unitNomor = user?.unit_nomor || "—";
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!unitId) return;
    api
      .get<Report>(`/report?unit_id=${unitId}&periode=${currentPeriod()}`)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [unitId]);

  const g = report?.gross_revenue || 0;
  const o = report?.opex_per_unit || 0;
  const mk = report?.marketing_amount || 0;
  const gp = report?.net ?? report?.gross_profit ?? 0;
  const ow = report?.owner_amount || 0;
  const lo = report?.pengelola_amount ?? report?.loonars_amount ?? 0;
  const opexPct = Math.round((report?.opex_pct ?? 0.25) * 100);
  const mkPct = Math.round((report?.marketing_pct ?? 0.275) * 100);

  const rows: [string, number, string, boolean?, boolean?, boolean?][] = [
    [`Pendapatan Unit ${unitNomor}`, 100, fmtCurrency(g), false, true],
    [`Opex (${opexPct}% dari omzet)`, Math.round((o / g || 0) * 100), `− ${fmtCurrency(o)}`, true],
    [`Marketing (${mkPct}% dari omzet)`, Math.round((mk / g || 0) * 100), `− ${fmtCurrency(mk)}`, true],
    ["Net Profit", Math.round((gp / g || 0) * 100), fmtCurrency(gp), false, true],
    ["Investor (70%)", 70, fmtCurrency(ow), false, false, true],
    ["Loonars (30%)", 30, fmtCurrency(lo), false],
    ["Transfer ke Investor — tgl 5", 70, fmtCurrency(ow), false, false, true],
  ];

  return (
    <InvestorShell pageTitle="Pendapatan" pageSub="Alur bagi hasil unit Anda">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3.5">
        <StatCard label="Investor (70%)" value={fmtCurrency(ow)} accent="sage" />
        <StatCard label="Gross Revenue" value={fmtCurrency(g)} />
        <StatCard label="Opex + Marketing" value={fmtCurrency(o + mk)} sub={`${opexPct}% + ${mkPct}%`} accent="gold" />
        <StatCard label="Net Profit" value={fmtCurrency(gp)} />
      </div>
      <Card>
        <CardHeader title="Alur Bagi Hasil" subtitle={periodLabel()} />
        {loading ? (
          <Loading />
        ) : (
          rows.map(([lbl, pct, val, isCost, isTot, isGold], i) => (
            <div key={i} className={`flex items-center px-4 sm:px-5 py-2.5 border-b border-white/[0.05] last:border-0 text-xs ${isTot ? "bg-gold-500/10" : ""}`}>
              <div className={`flex-1 ${isTot ? "text-white/80 font-medium" : "text-white/50"} ${isGold ? "text-gold-500" : ""}`}>{lbl}</div>
              <div className="w-16 sm:w-20 mx-3 h-1 bg-white/[0.08] rounded-full shrink-0 hidden sm:block">
                <div
                  className={`h-full rounded-full ${isCost ? "bg-ruby-500" : isGold ? "bg-gold-500" : "bg-sage-500"}`}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <div
                className={`font-mono text-[11.5px] font-medium text-right min-w-[100px] ${
                  isGold ? "text-gold-500" : isCost ? "text-ruby-400" : isTot ? "text-white/80" : "text-white/50"
                }`}
              >
                {val}
              </div>
            </div>
          ))
        )}
      </Card>
    </InvestorShell>
  );
}
