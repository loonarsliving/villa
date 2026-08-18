"use client";

import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader } from "@/components/Card";

function lastMonths(n: number) {
  const out: { period: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      period: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

export default function LaporanPage() {
  const { user } = useAuth();
  const months = lastMonths(6);

  return (
    <InvestorShell pageTitle="Laporan Bulanan" pageSub="Riwayat & unduhan">
      <Card>
        <CardHeader title={`Laporan Bulanan — Unit ${user?.unit_nomor || "—"}`} />
        {months.map((m, i) => (
          <div key={m.period} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
            <div className="w-8 h-8 bg-gold-500/10 border border-gold-500/25 rounded flex items-center justify-center text-sm shrink-0">📄</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-ink/80">Laporan {m.label}</div>
              <div className="text-[10px] text-ink/30 mt-0.5">{i === 0 ? "Sedang berjalan" : "Diterbitkan tgl 5"}</div>
            </div>
            <div className={`text-[10.5px] font-semibold px-2.5 py-1 border rounded shrink-0 ${i === 0 ? "opacity-30 border-ink/10 text-ink/30" : "border-gold-500/25 text-gold-500 cursor-pointer"}`}>
              {i === 0 ? "⏳" : "⬇ PDF"}
            </div>
          </div>
        ))}
      </Card>
    </InvestorShell>
  );
}
