import { fmtCurrencyFull } from "@/lib/format";
import { Card, CardHeader } from "@/components/Card";
import type { Report } from "@/lib/types";

/**
 * Rincian COGS dan OPEX untuk investor (owner 2026-10-19: "prinsip
 * keterbukaan dengan investor ini benar-benar real"). Semua angka apa
 * adanya dari GET /report; tidak ada rumus di halaman.
 */

function Baris({ label, sub, nilai, tebal }: { label: string; sub?: string; nilai: string; tebal?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0 text-xs ${tebal ? "bg-gold-500/10 font-medium" : ""}`}>
      <div>
        <div className={tebal ? "text-ink/80" : "text-ink/60"}>{label}</div>
        {sub && <div className="text-[10.5px] text-ink/35 mt-0.5">{sub}</div>}
      </div>
      <div className="font-mono text-[11.5px] text-ink/70 shrink-0 text-right">{nilai}</div>
    </div>
  );
}

export function RincianBiayaInvestor({ report }: { report: Report }) {
  const c = report.cogs_standar;
  const opex = report.opex_rincian;
  if (!c || !opex) return null;
  const pct = `${c.okupansi_standar_pct.toString().replace(".", ",")}%`;
  const berjalan = report.hari_dihitung != null && report.hari_bulan != null && report.hari_dihitung < report.hari_bulan;

  return (
    <>
      <Card className="mt-3.5">
        <CardHeader title="Rincian COGS" subtitle="Biaya untuk setiap kamar yang terisi semalam" />
        <div className="px-4 sm:px-5 pt-3 pb-1 text-[10px] text-ink/35 uppercase tracking-wide">Biaya langsung per malam</div>
        {c.biaya_langsung.map((k) => (
          <Baris key={k.label} label={k.label} nilai={fmtCurrencyFull(k.nominal)} />
        ))}
        <div className="px-4 sm:px-5 pt-3 pb-1 text-[10px] text-ink/35 uppercase tracking-wide">Biaya tetap pendukung per bulan</div>
        {c.biaya_tetap_bulanan.map((k) => (
          <Baris key={k.label} label={k.label} nilai={`${fmtCurrencyFull(k.nominal)}/bln`} />
        ))}
        <Baris
          label="Biaya tetap per malam"
          sub={`${fmtCurrencyFull(c.biaya_tetap_per_bulan)} dibagi ${c.malam_standar_per_bulan} malam (${c.total_kamar} kamar x 30 hari x okupansi standar ${pct})`}
          nilai={fmtCurrencyFull(c.alokasi_tetap_per_malam)}
        />
        <Baris label="COGS per kamar/malam" nilai={fmtCurrencyFull(c.cogs_per_malam)} tebal />
        <Baris
          label="COGS bulan ini"
          sub={`${fmtCurrencyFull(c.cogs_per_malam)} x ${report.malam_terisi ?? 0} malam terisi`}
          nilai={fmtCurrencyFull(report.cogs)}
          tebal
        />
      </Card>

      <Card className="mt-3.5">
        <CardHeader title="Rincian OPEX" subtitle="Gaji staf yang dipekerjakan saat ini" />
        {opex.map((p) => (
          <Baris
            key={p.peran}
            label={`${p.peran} (${p.orang} orang)`}
            sub={`${fmtCurrencyFull(p.gaji_per_orang)} per orang`}
            nilai={`${fmtCurrencyFull(p.per_bulan)}/bln`}
          />
        ))}
        <Baris
          label="OPEX bulan ini"
          sub={berjalan ? `${fmtCurrencyFull(report.payroll_bulanan)}/bln, dihitung ${report.hari_dihitung} dari ${report.hari_bulan} hari (bulan berjalan)` : undefined}
          nilai={fmtCurrencyFull(report.opex)}
          tebal
        />
      </Card>
    </>
  );
}
