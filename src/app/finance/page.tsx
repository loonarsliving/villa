"use client";

import { FinanceShell } from "./_shell";
import { SurvivalControlCenter } from "./_SurvivalControlCenter";
import { PeriodeBar, usePeriode } from "./_periode";

/**
 * Ringkasan Finance: hanya posisi hari ini (status, target kamar, bulan
 * ini). Modul lain punya menu sendiri (owner 2026-10-21: "buat per menu
 * saja, jika diklik baru tampil"): Rencana Kas, Laba Rugi & COGS,
 * Pendapatan & Channel, dan Transaksi.
 */
export default function FinancePage() {
  const periode = usePeriode();
  return (
    <FinanceShell pageTitle="Ringkasan" pageSub="Posisi Loonars 1 hari ini dan target bulan ini">
      <PeriodeBar p={periode} />
      <SurvivalControlCenter from={periode.range.from} to={periode.range.to} />
    </FinanceShell>
  );
}
