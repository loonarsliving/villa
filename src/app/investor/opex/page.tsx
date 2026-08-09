"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency, currentPeriod, periodLabel } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading } from "@/components/Card";
import type { Report } from "@/lib/types";

export default function OpexPage() {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!unitId) return;
    api
      .get<Report>(`/report?unit_id=${unitId}&periode=${currentPeriod()}`)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [unitId]);

  const pct = Math.round((report?.opex_pct ?? 0.25) * 100);

  return (
    <InvestorShell pageTitle="Rincian Opex" pageSub="Biaya operasional properti">
      <Card>
        <CardHeader title="Opex Bulan Ini" subtitle={periodLabel()} />
        <CardBody>
          {loading ? (
            <Loading />
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-4">
                <div className="font-serif text-4xl font-light text-gold-500">{pct}%</div>
                <div className="text-xs text-white/40">dari omzet kotor unit — dibekukan sesuai akad</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-base-800 border border-white/[0.08] rounded p-4">
                  <div className="text-[9px] text-white/30 uppercase tracking-wide">Gross Revenue</div>
                  <div className="font-serif text-xl font-light text-white mt-1">{fmtCurrency(report?.gross_revenue)}</div>
                </div>
                <div className="bg-gold-500/10 border border-gold-500/25 rounded p-4">
                  <div className="text-[9px] text-gold-500 uppercase tracking-wide">Opex Unit Ini</div>
                  <div className="font-serif text-xl font-light text-gold-500 mt-1">{fmtCurrency(report?.opex_per_unit)}</div>
                </div>
              </div>
              <div className="text-[11px] text-white/30 leading-relaxed mt-5 bg-base-800 border-l-2 border-gold-500/40 rounded-r p-3.5">
                Opex properti tidak lagi dihitung dari rincian biaya aktual bulanan, melainkan tetap {pct}% dari omzet kotor
                setiap unit sesuai kesepakatan (akad) yang berlaku — sehingga jumlahnya konsisten dan mudah diprediksi setiap bulan.
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </InvestorShell>
  );
}
