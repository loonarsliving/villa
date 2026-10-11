"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { api } from "@/lib/api";
import { Card, CardHeader, Loading } from "@/components/Card";
import { currentPeriod, fmtCurrencyFull, recentPeriods } from "@/lib/format";
import { buildGrowthRows, type GrowthRow } from "@/lib/investorGrowth";
import type { Report } from "@/lib/types";

/**
 * Pertumbuhan pendapatan Loonars untuk investor (permintaan owner
 * 2026-10-11): investor melihat perkembangan pendapatan seluruh villa dari
 * bulan ke bulan, supaya setelah satu tahun bisa menilai sendiri skema bagi
 * hasil murni 70:30 dari profit. Halaman ini hanya menampilkan angka
 * GET /report per bulan -- tidak ada rumus atau proyeksi baru.
 */
export default function PertumbuhanPage() {
  const [rows, setRows] = useState<GrowthRow[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    const months = recentPeriods(12);
    Promise.all(months.map((m) => api.get<Report>(`/report?periode=${m.period}`).catch(() => null)))
      .then((reports) => {
        if (reports.every((r) => r === null)) throw new Error("Gagal memuat data pertumbuhan.");
        setRows(buildGrowthRows(months, reports, currentPeriod()));
      })
      .catch((e: unknown) => setGalat(e instanceof Error ? e.message : "Gagal memuat data pertumbuhan."));
  }, []);

  const maxGross = Math.max(1, ...(rows ?? []).map((r) => r.gross));
  const selesai = (rows ?? []).filter((r) => !r.berjalan);
  const terakhir = selesai.at(-1);

  return (
    <InvestorShell pageTitle="Pertumbuhan Loonars" pageSub="Perkembangan pendapatan seluruh villa">
      {terakhir && (
        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <div className="bg-base-800 border border-ink/[0.08] rounded p-4">
            <div className="text-[9px] text-ink/40 uppercase tracking-wide">Pendapatan {terakhir.label}</div>
            <div className="font-serif text-xl font-light text-ink mt-1">{fmtCurrencyFull(terakhir.gross)}</div>
          </div>
          <div className="bg-base-800 border border-ink/[0.08] rounded p-4">
            <div className="text-[9px] text-ink/40 uppercase tracking-wide">Dibanding bulan sebelumnya</div>
            <div className="font-serif text-xl font-light text-ink mt-1">{fmtPct(terakhir.changePct)}</div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader title="Pendapatan Seluruh Villa per Bulan" subtitle="Bulan berjalan ditandai sementara" />
        {galat ? (
          <div className="px-4 sm:px-5 py-4 text-[11.5px] text-ruby-500">{galat}</div>
        ) : !rows ? (
          <Loading label="Memuat data…" />
        ) : rows.length === 0 ? (
          <div className="px-4 sm:px-5 py-4 text-[11px] text-ink/40">Belum ada pendapatan tercatat.</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.period}
              className="px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0"
              title={`${r.label}: pendapatan ${fmtCurrencyFull(r.gross)}, net profit ${fmtCurrencyFull(r.net)}, bagian 70:30 per unit ${fmtCurrencyFull(r.perUnit)}`}
            >
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <div className="text-ink/80 font-medium">
                  {r.label}
                  {r.berjalan && <span className="ml-1.5 text-[9.5px] text-ink/40 font-normal">sementara</span>}
                </div>
                <div className="font-mono text-[11.5px] text-ink/80">{fmtCurrencyFull(r.gross)}</div>
              </div>
              <div className="mt-1.5 h-2 bg-ink/[0.06] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${r.berjalan ? "bg-gold-500/50" : "bg-gold-500"}`}
                  style={{ width: `${Math.max(1, (r.gross / maxGross) * 100)}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[10px] text-ink/40">
                <span>Net profit {fmtCurrencyFull(r.net)}</span>
                <span>Bagian 70:30 per unit {fmtCurrencyFull(r.perUnit)}</span>
                {r.changePct !== null && <span className="text-ink/60">{fmtPct(r.changePct)} dari bulan lalu</span>}
              </div>
            </div>
          ))
        )}
      </Card>

      <div className="text-[11px] text-ink/40 leading-relaxed mt-3.5 bg-base-800 border-l-2 border-gold-500/40 rounded-r p-3.5">
        &ldquo;Bagian 70:30 per unit&rdquo; adalah bagian satu unit bila bagi hasil dihitung murni 70% dari net profit
        untuk investor dan 30% untuk Loonars, dibagi rata ke seluruh unit. Angka ini dihitung sistem dari pendapatan yang
        sudah tercatat setiap bulan.
      </div>
    </InvestorShell>
  );
}

function fmtPct(p: number | null): string {
  if (p === null) return "—";
  const v = Math.round(p * 10) / 10;
  return `${v > 0 ? "+" : ""}${v.toLocaleString("id-ID")}%`;
}
