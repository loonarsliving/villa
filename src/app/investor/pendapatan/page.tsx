"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency, currentPeriod, periodLabel } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { pendapatanInvestor } from "@/lib/investorPendapatan";
import type { Report } from "@/lib/types";

export default function PendapatanPage() {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    // villa-api mengabaikan unit_id untuk investor dan memakai sesi login,
    // jadi investor tanpa unit fisik (skema pemasukan tetap) tetap dimuat --
    // dulu halaman ini menunggu unitId selamanya dan spinner tak pernah hilang.
    api
      .get<Report>(`/report?unit_id=${unitId}&periode=${currentPeriod()}`)
      .then(setReport)
      // Tanpa catch, kegagalan jaringan tampil sebagai "Rp 0" -- terbaca
      // seolah villa tidak berpendapatan sama sekali.
      .catch((e: unknown) => setGalat(e instanceof Error ? e.message : "Gagal memuat data."))
      .finally(() => setLoading(false));
  }, [unitId]);

  // Pendapatan sudah setelah potongan pemasaran/OTA; baris marketing tidak
  // ditampilkan (owner 2026-10-11, lihat lib/investorPendapatan.ts).
  const g = pendapatanInvestor(report);
  const o = report?.opex_per_unit || 0;
  const gp = report?.net ?? report?.gross_profit ?? 0;
  const ow = report?.owner_amount || 0;
  const lo = report?.pengelola_amount ?? report?.loonars_amount ?? 0;
  const perInvestor = report?.per_investor_amount ?? 0;
  // Investor berskema tetap tidak ikut pembagian itu. Menampilkan
  // "1 dari 13 investor" kepadanya bukan cuma tidak relevan -- angkanya
  // memang bukan angka yang dia terima.
  const pemasukanTetap = report?.pemasukan_tetap ?? null;
  const bagianAnda = report?.bagian_anda ?? perInvestor;

  const rows: [string, number, string, boolean?, boolean?, boolean?][] = [
    ["Pendapatan Seluruh Villa", 100, fmtCurrency(g), false, true],
    ["Opex (sesuai akad)", Math.round((o / g || 0) * 100), `− ${fmtCurrency(o)}`, true],
    ["Net Profit", Math.round((gp / g || 0) * 100), fmtCurrency(gp), false, true],
    ["Pool Investor (70%)", 70, fmtCurrency(ow), false, false, true],
    ["Loonars (30%)", 30, fmtCurrency(lo), false],
    pemasukanTetap !== null
      ? ["Pemasukan Anda (angka tetap sesuai skema pembelian)", 70, fmtCurrency(bagianAnda), false, false, true]
      : ["Bagian Anda", 70, fmtCurrency(bagianAnda), false, false, true],
  ];

  return (
    <InvestorShell pageTitle="Pendapatan" pageSub="Pemasukan seluruh villa dan hak Anda">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3.5">
        <StatCard label={pemasukanTetap !== null ? "Pemasukan Anda" : "Bagian Anda"} value={fmtCurrency(bagianAnda)} accent="sage" />
        <StatCard label="Pendapatan Villa" value={fmtCurrency(g)} sub="Seluruh villa" />
        <StatCard label="Opex" value={fmtCurrency(o)} sub="Sesuai akad" accent="gold" />
        <StatCard label="Net Profit" value={fmtCurrency(gp)} />
      </div>
      <Card>
        <CardHeader
          title="Alur Bagi Hasil"
          subtitle={
            pemasukanTetap !== null
              ? `${periodLabel()} — pemasukan Anda tetap, tidak mengikuti alur di bawah`
              : periodLabel()
          }
        />
        {loading ? (
          <Loading />
        ) : galat ? (
          <div className="px-4 sm:px-5 py-4 text-[11.5px] text-ruby-500">{galat}</div>
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

    </InvestorShell>
  );
}
