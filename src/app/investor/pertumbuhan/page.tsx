"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { api } from "@/lib/api";
import { Card, CardHeader, Loading } from "@/components/Card";
import { currentPeriod, fmtCurrencyFull, recentPeriods } from "@/lib/format";
import { buildGrowthRows, type GrowthRow } from "@/lib/investorGrowth";
import type { Report } from "@/lib/types";
import { AngkaRingkas, DiagramKolom, Saklar, Tombol, WARNA_UTAMA } from "@/components/viz";

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
  const [metrik, setMetrik] = useState<"gross" | "net" | "perUnit">("gross");

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
        <Card className="mb-3.5">
          <div className="p-4 sm:p-5 grid grid-cols-2 gap-x-4 gap-y-3">
            <AngkaRingkas label={`Pendapatan ${terakhir.label}`} nilai={fmtCurrencyFull(terakhir.gross)} />
            <AngkaRingkas
              label="Dibanding bulan sebelumnya"
              nilai={fmtPct(terakhir.changePct)}
              tone={terakhir.changePct === null || terakhir.changePct === 0 ? undefined : terakhir.changePct > 0 ? "sage" : "ruby"}
            />
          </div>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <Card className="mb-3.5">
          <CardHeader
            title="Grafik 12 Bulan"
            subtitle="Ketuk batang untuk melihat angkanya; bulan berjalan tampil pudar"
          />
          <div className="px-4 sm:px-5 pt-3 pb-3">
            <Saklar className="mb-4">
              <Tombol aktif={metrik === "gross"} onClick={() => setMetrik("gross")}>Pendapatan</Tombol>
              <Tombol aktif={metrik === "net"} onClick={() => setMetrik("net")}>Net profit</Tombol>
              <Tombol aktif={metrik === "perUnit"} onClick={() => setMetrik("perUnit")}>Per unit</Tombol>
            </Saklar>
            <DiagramKolom
              ariaLabel="Pendapatan seluruh villa per bulan"
              formatPenuh={fmtCurrencyFull}
              kolom={rows.map((r) => ({
                kunci: r.period,
                label: r.label.split(" ")[0].slice(0, 3),
                judul: r.label + (r.berjalan ? " (sementara)" : ""),
                pudar: r.berjalan,
                // Nilai negatif (rugi) tidak digambar ke bawah; batangnya kosong dan angkanya tetap tampil apa adanya.
                segmen: [{ nama: "Nilai", nilai: Math.max(0, r[metrik]), warna: WARNA_UTAMA }],
                nilaiTampil: fmtCurrencyFull(r[metrik]),
                catatan: r.changePct !== null ? `${fmtPct(r.changePct)} pendapatan dari bulan lalu` : undefined,
              }))}
            />
          </div>
        </Card>
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
