"use client";

import { useState } from "react";
import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/Card";
import { fmtDateTime, recentPeriods } from "@/lib/format";
import { buildInvestorReportPdf } from "@/lib/investorReportPdf";
import type { Report } from "@/lib/types";

/**
 * Tombol "⬇ PDF" di sini dulu hanya hiasan (div tanpa aksi), jadi investor
 * tidak pernah bisa mengunduh apa pun. Sekarang setiap baris mengambil
 * GET /report untuk bulan itu lalu membuat PDF-nya di browser -- angkanya
 * sama dengan halaman Pendapatan, tidak ada rumus baru.
 */
export default function LaporanPage() {
  const { user } = useAuth();
  const months = recentPeriods(6);
  const [busy, setBusy] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  // Sama dengan label di InvestorShell: investor berskema khusus tidak
  // punya unit fisik, jadi jangan ditulis "Unit Pemasukan Tetap".
  const unitLabel = user?.unit_id ? `Unit ${user.unit_nomor || "-"}` : user?.unit_nomor || "Skema Khusus";

  async function unduh(period: string, label: string) {
    setGalat(null);
    setBusy(period);
    try {
      const report = await api.get<Report>(`/report?periode=${period}`);
      const bytes = buildInvestorReportPdf({
        report,
        periodLabel: label,
        investorName: user?.nama || "-",
        unitLabel,
        generatedAt: fmtDateTime(new Date().toISOString(), { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Laporan-Loonars-${period}${user?.unit_nomor && user.unit_id ? `-${user.unit_nomor}` : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal membuat laporan. Coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <InvestorShell pageTitle="Laporan Bulanan" pageSub="Riwayat & unduhan">
      <Card>
        <CardHeader title={`Laporan Bulanan — ${unitLabel}`} />
        {galat && <div className="px-4 sm:px-5 py-3 text-[11.5px] text-ruby-500 border-b border-ink/[0.05]">{galat}</div>}
        {months.map((m, i) => (
          <div key={m.period} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
            <div className="w-8 h-8 bg-gold-500/10 border border-gold-500/25 rounded flex items-center justify-center text-sm shrink-0">📄</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-ink/80">Laporan {m.label}</div>
              <div className="text-[10px] text-ink/30 mt-0.5">{i === 0 ? "Sedang berjalan — angka sementara" : "Diterbitkan tgl 5"}</div>
            </div>
            <button
              type="button"
              onClick={() => unduh(m.period, m.label)}
              disabled={busy !== null}
              className="text-[10.5px] font-semibold px-2.5 py-1 border rounded shrink-0 border-gold-500/25 text-gold-500 disabled:opacity-40"
            >
              {busy === m.period ? "Membuat…" : "⬇ PDF"}
            </button>
          </div>
        ))}
      </Card>
    </InvestorShell>
  );
}
