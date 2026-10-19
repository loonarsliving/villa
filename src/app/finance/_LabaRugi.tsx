"use client";

import { fmtCurrency, fmtCurrencyFull } from "@/lib/format";
import { Card, CardHeader } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { BIAYA_LANGSUNG, BIAYA_TETAP_BULANAN, HARI_PER_BULAN, OKUPANSI_STANDAR_PCT, hitungLabaRugi } from "@/lib/cogsStandar";
import type { FinanceSurvivalKpis } from "@/lib/types";

/**
 * Laba rugi sederhana + rincian COGS untuk /finance (owner 2026-10-19).
 * Angka pendapatan, malam terjual, dan payroll diambil apa adanya dari
 * villa-api /finance/survival; COGS dihitung di src/lib/cogsStandar.ts.
 */

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1).replace(".", ",")}%`;
}

function Baris({ label, sub, nilai, tone, tebal }: { label: string; sub?: string; nilai: number; tone?: "minus" | "hasil"; tebal?: boolean }) {
  const warna = tone === "minus" ? "text-ruby-500" : tone === "hasil" ? (nilai >= 0 ? "text-sage-600" : "text-ruby-500") : "text-ink/80";
  return (
    <div className={`flex items-start justify-between gap-3 py-2 ${tebal ? "font-semibold" : ""}`}>
      <div>
        <div className={tebal ? "text-ink" : "text-ink/70"}>{label}</div>
        {sub && <div className="text-[10px] text-ink/40 font-normal">{sub}</div>}
      </div>
      <div className={`shrink-0 text-right ${warna}`}>
        {tone === "minus" ? "− " : ""}
        {fmtCurrencyFull(tone === "minus" ? Math.abs(nilai) : nilai)}
      </div>
    </div>
  );
}

export function LabaRugi({ data }: { data: FinanceSurvivalKpis }) {
  const lr = hitungLabaRugi({
    totalKamar: data.config.total_rooms,
    hariPeriode: data.period.days,
    malamTerjual: data.room_nights_mtd,
    grossRevenue: data.gross_revenue_mtd,
    komisiOta: data.ota_commission_mtd,
    netRevenue: data.net_revenue_mtd,
    payroll: data.opex_breakdown.payroll,
  });
  const st = lr.standar;
  const periode = `${data.period.from} s/d ${data.period.to} · ${data.period.days} hari`;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="Net Revenue" value={fmtCurrency(lr.netRevenue)} accent="azure" sub={`${data.room_nights_mtd} malam terjual`} />
        <StatCard label="COGS" value={fmtCurrency(lr.cogs)} accent="ruby" sub={`${fmtCurrencyFull(st.cogsPerMalam)} × ${data.room_nights_mtd} malam`} />
        <StatCard label="Gross Profit" value={fmtCurrency(lr.grossProfit)} accent={lr.grossProfit >= 0 ? "sage" : "ruby"} sub={`Gross margin ${fmtPct(lr.grossMarginPct)}`} />
        <StatCard label="Net Profit" value={fmtCurrency(lr.netProfit)} accent={lr.netProfit >= 0 ? "sage" : "ruby"} sub={`Net margin ${fmtPct(lr.netMarginPct)}`} />
      </div>

      <Card className="mb-4">
        <CardHeader title="Laba Rugi" subtitle={periode} />
        <div className="px-4 sm:px-5 pb-4 text-[12px] divide-y divide-ink/5">
          <Baris label="Gross Revenue" sub="Grand Total Cloudbeds, tamu sudah check-in" nilai={lr.grossRevenue} />
          <Baris label="Komisi OTA" nilai={lr.komisiOta} tone="minus" />
          <Baris label="Net Revenue" sub="Uang yang benar-benar diterima villa" nilai={lr.netRevenue} tebal />
          <Baris label="COGS (Harga Pokok Penjualan)" sub={`${fmtCurrencyFull(st.cogsPerMalam)} per malam × ${data.room_nights_mtd} malam terjual`} nilai={lr.cogs} tone="minus" />
          <Baris label="Gross Profit" sub={`Gross margin ${fmtPct(lr.grossMarginPct)}`} nilai={lr.grossProfit} tone="hasil" tebal />
          <Baris label="Payroll" sub="Dari Konfigurasi Properti, diprorata per hari" nilai={lr.payroll} tone="minus" />
          {lr.biayaTetapBelumTerserap !== 0 && (
            <Baris
              label={lr.biayaTetapBelumTerserap > 0 ? "Biaya tetap belum terserap COGS" : "Biaya tetap terserap lebih (koreksi)"}
              sub={`Okupansi periode ${fmtPct(lr.okupansiPct)} vs standar ${fmtPct(OKUPANSI_STANDAR_PCT)}: biaya tetap aktual ${fmtCurrencyFull(lr.biayaTetapAktual)}, yang masuk COGS ${fmtCurrencyFull(lr.biayaTetapTerserap)}`}
              nilai={lr.biayaTetapBelumTerserap}
              tone={lr.biayaTetapBelumTerserap > 0 ? "minus" : undefined}
            />
          )}
          <Baris label="Net Profit" sub={`Net margin ${fmtPct(lr.netMarginPct)} · sebelum bagi hasil investor & pajak`} nilai={lr.netProfit} tone="hasil" tebal />
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Rincian COGS per Kamar/Malam" subtitle={`Okupansi standar minimum ${fmtPct(OKUPANSI_STANDAR_PCT)} sebagai acuan`} />
        <div className="px-4 sm:px-5 pb-4 text-[12px]">
          <div className="text-[10px] text-ink/40 uppercase tracking-wide pt-1 pb-1">A. Biaya langsung (per malam terjual)</div>
          <div className="divide-y divide-ink/5">
            {BIAYA_LANGSUNG.map((k) => (
              <div key={k.key} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="text-ink/80">{k.label}</div>
                  <div className="text-[10px] text-ink/40">{k.penjelasan}</div>
                </div>
                <div className="shrink-0">{fmtCurrencyFull(k.nominal)}</div>
              </div>
            ))}
          </div>

          <div className="text-[10px] text-ink/40 uppercase tracking-wide pt-3 pb-1">B. Biaya tetap pendukung (per bulan)</div>
          <div className="divide-y divide-ink/5">
            {BIAYA_TETAP_BULANAN.map((k) => (
              <div key={k.key} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="text-ink/80">{k.label}</div>
                  <div className="text-[10px] text-ink/40">{k.penjelasan}</div>
                </div>
                <div className="shrink-0">{fmtCurrencyFull(k.nominal)}/bln</div>
              </div>
            ))}
            <div className="flex items-start justify-between gap-3 py-2">
              <div>
                <div className="text-ink/80">Alokasi biaya tetap per malam</div>
                <div className="text-[10px] text-ink/40">
                  {fmtCurrencyFull(st.biayaTetapPerBulan)} ÷ {st.malamStandarPerBulan} malam ({st.totalKamar} kamar × {HARI_PER_BULAN} hari × {fmtPct(OKUPANSI_STANDAR_PCT)})
                </div>
              </div>
              <div className="shrink-0">{fmtCurrencyFull(st.alokasiTetapPerMalam)}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-ink/15 font-semibold">
            <div>COGS standar per kamar/malam</div>
            <div>{fmtCurrencyFull(st.cogsPerMalam)}</div>
          </div>
          <div className="text-[10px] text-ink/40 leading-relaxed pt-3">
            Biaya langsung {fmtCurrencyFull(st.biayaLangsungPerMalam)} + alokasi biaya tetap {fmtCurrencyFull(st.alokasiTetapPerMalam)}. Okupansi standar dipakai supaya
            internet, listrik receptionist, dan Cloudbeds ikut masuk COGS. Kalau okupansi di bawah standar, sisa biaya tetap yang belum terserap dicatat di
            bawah Gross Profit, jadi Net Profit tetap menghitung seluruh biaya. Listrik kamar sudah di COGS, jadi tidak dihitung lagi di OPEX. Hanya untuk
            analisis Finance, tidak memengaruhi harga kamar maupun bagi hasil investor.
          </div>
        </div>
      </Card>
    </>
  );
}
