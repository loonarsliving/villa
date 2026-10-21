"use client";

import { useEffect, useState } from "react";
import { FinanceShell } from "../_shell";
import { LabaRugi } from "../_LabaRugi";
import { PeriodeBar, usePeriode } from "../_periode";
import { api } from "@/lib/api";
import { Loading } from "@/components/Card";
import type { FinanceSurvivalKpis } from "@/lib/types";

/**
 * Laba Rugi & COGS: Revenue -> COGS -> Gross Profit -> OPEX -> Net Profit
 * dengan rincian COGS dan OPEX. Angka pendapatan dan malam terisi dari
 * villa-api /finance/survival; COGS dan gaji dari src/lib/cogsStandar.ts.
 */
export default function LabaRugiPage() {
  const periode = usePeriode();
  const { from, to } = periode.range;
  const [data, setData] = useState<FinanceSurvivalKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Ganti periode cepat memicu dua load bersamaan; jawaban yang datang
    // terlambat tidak boleh menimpa periode yang sedang dipilih.
    let batal = false;
    setLoading(true);
    setError(null);
    api
      .get<FinanceSurvivalKpis>(`/finance/survival?property=loonars-1&from=${from}&to=${to}`)
      .then((d) => {
        if (!batal) setData(d);
      })
      .catch((e) => {
        if (!batal) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!batal) setLoading(false);
      });
    return () => {
      batal = true;
    };
  }, [from, to]);

  return (
    <FinanceShell pageTitle="Laba Rugi & COGS" pageSub="Revenue → COGS → Gross Profit → OPEX → Net Profit">
      <PeriodeBar p={periode} />
      {loading && <Loading label="Memuat laba rugi..." />}
      {error && <div className="text-ruby-500 text-xs px-1 py-3">Gagal memuat: {error}</div>}
      {!loading && !error && data && <LabaRugi data={data} />}
    </FinanceShell>
  );
}
