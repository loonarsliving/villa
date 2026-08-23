"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InvestorShell } from "./_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency, fmtDate, currentPeriod, periodLabel } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { Report, Transaction, Notification } from "@/lib/types";

export default function InvestorBerandaPage() {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const unitNomor = user?.unit_nomor || "—";
  const [report, setReport] = useState<Report | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!unitId) return;
    const bulan = currentPeriod();
    Promise.all([
      api.get<Report>(`/report?unit_id=${unitId}&periode=${bulan}`),
      api.get<Transaction[]>(`/transactions?unit_id=${unitId}&bulan=${bulan}`),
      api.get<Notification[]>(`/notifications?unit_id=${unitId}&role=owner`),
    ])
      .then(([r, t, n]) => {
        setReport(r);
        setTxs(t || []);
        setNotifs(n || []);
      })
      .finally(() => setLoading(false));
  }, [unitId]);

  const owner = report?.owner_amount || 0;
  const jaminanAktif = report?.jaminan_aktif;

  return (
    <InvestorShell pageTitle="Beranda" pageSub={`Unit ${unitNomor} · ${periodLabel()}`}>
      <div
        className="relative bg-gradient-to-br from-base-800 to-base-900 border border-gold-500/25 rounded-md p-5 sm:p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 mb-3.5 overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-gold-500 to-transparent" />
        <div>
          <div className="text-[9px] text-gold-500 tracking-[0.2em] uppercase font-semibold mb-2">
            Jaminan Pendapatan Minimal
          </div>
          <div className="font-serif text-xl sm:text-[22px] font-light text-ink leading-snug">
            Anda selalu dapat minimal
            <br />
            Rp 5.000.000 per bulan
          </div>
          <div className="text-[11px] text-ink/30 mt-2 leading-relaxed max-w-xs">
            {loading
              ? "Memuat data..."
              : jaminanAktif
                ? `Pendapatan rendah bulan ini — Loonars menambah ${fmtCurrency(report?.jaminan_topup)} agar Anda tetap terima Rp 5 juta.`
                : `Unit ${unitNomor} berjalan normal — jaminan tidak aktif, bagi hasil penuh untuk Anda.`}
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="font-serif text-3xl sm:text-[38px] font-light text-gold-500 leading-none">{fmtCurrency(owner)}</div>
          <div className="text-[9.5px] text-ink/30 mt-1">Estimasi diterima bulan ini</div>
          <div
            className={`inline-flex items-center gap-1.5 text-[9.5px] font-semibold px-2.5 py-1 rounded-full mt-2.5 ${
              jaminanAktif ? "bg-ruby-500/15 text-ruby-400" : "bg-sage-500/15 text-sage-400"
            }`}
          >
            {jaminanAktif ? "⚠ Jaminan aktif" : "✓ Jaminan tidak aktif"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3.5">
        <StatCard label="Pendapatan Anda" value={fmtCurrency(owner)} sub="Bulan ini (70%)" accent="sage" />
        <StatCard label="Gross Revenue" value={fmtCurrency(report?.gross_revenue)} sub="Unit ini" />
        <StatCard
          label="Opex + Marketing"
          value={fmtCurrency((report?.opex_per_unit || 0) + (report?.marketing_amount || 0))}
          sub={`Opex ${Math.round((report?.opex_pct ?? 0.25) * 100)}% + iklan ${Math.round((report?.marketing_pct ?? 0.275) * 100)}%`}
          accent="gold"
        />
        <StatCard label="Net Profit" value={fmtCurrency(report?.net ?? report?.gross_profit)} sub="Dasar bagi hasil 70/30" />
      </div>

      {!loading && report?.walkin_income && (
        <Card className="mb-3.5">
          <CardHeader
            title="Pemasukan Cafe & Spa (Walk-in)"
            subtitle="Info seluruh properti — belum termasuk bagi hasil 70/30 di atas"
          />
          <div className="grid grid-cols-3 gap-3 p-4 sm:p-5">
            <div>
              <div className="text-[10px] text-ink/40 mb-1">☕ Cafe</div>
              <div className="font-serif text-base font-medium text-ink">{fmtCurrency(report.walkin_income.cafe)}</div>
            </div>
            <div>
              <div className="text-[10px] text-ink/40 mb-1">💆 Spa</div>
              <div className="font-serif text-base font-medium text-ink">{fmtCurrency(report.walkin_income.spa)}</div>
            </div>
            <div>
              <div className="text-[10px] text-ink/40 mb-1">Total</div>
              <div className="font-serif text-base font-medium text-gold-500">{fmtCurrency(report.walkin_income.total)}</div>
            </div>
          </div>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 -mt-1 text-[10px] text-ink/30 leading-relaxed">
            Pemasukan ini di luar sewa unit dan belum dibagikan ke investor — ditampilkan untuk transparansi karena rencananya akan ikut dibagi dari pendapatan bersih ke depannya.
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-[2fr_1fr] gap-3.5">
        <Card>
          <CardHeader title="Transaksi Terbaru" action={<Link href="/investor/pendapatan" className="text-[10.5px] text-gold-500">Lihat semua →</Link>} />
          {loading ? (
            <Loading />
          ) : txs.length === 0 ? (
            <Loading label="Belum ada transaksi bulan ini" />
          ) : (
            txs.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
                <div className={`w-8 h-8 rounded flex items-center justify-center text-sm shrink-0 ${t.tipe === "transfer_owner" ? "bg-gold-500/10" : "bg-sage-500/15"}`}>
                  {t.tipe === "transfer_owner" ? "🏦" : "💳"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-ink/80 truncate">{t.deskripsi}</div>
                  <div className="text-[10px] text-ink/30 mt-0.5">
                    {fmtDate(t.created_at)} · {t.kategori || ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-xs font-medium text-sage-400">+ {fmtCurrency(t.jumlah)}</div>
                </div>
              </div>
            ))
          )}
        </Card>
        <Card>
          <CardHeader title="Notifikasi" action={<Link href="/investor/notifikasi" className="text-[10.5px] text-gold-500">Lihat semua →</Link>} />
          {loading ? (
            <Loading />
          ) : notifs.length === 0 ? (
            <Loading label="Tidak ada notifikasi" />
          ) : (
            notifs.slice(0, 4).map((n) => (
              <div key={n.id} className="flex gap-2.5 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 items-start">
                <div className="w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0 mt-1.5" />
                <div>
                  <div className="text-[11.5px] text-ink/50 leading-relaxed">
                    <b className="text-ink">{n.judul}</b> — {n.pesan}
                  </div>
                  <div className="text-[9.5px] text-ink/30 mt-0.5">{fmtDate(n.created_at)}</div>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </InvestorShell>
  );
}
