"use client";

import { useEffect, useState } from "react";
import { FinanceShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrencyFull, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { inputCls } from "@/components/Modal";
import type { ElFinanceRingkasan } from "@/lib/types";

function awalBulan(): string {
  return `${todayISO().slice(0, 7)}-01`;
}
function akhirBulan(): string {
  const d = new Date(`${awalBulan()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function Rincian({ title, data }: { title: string; data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <Empty label="Belum ada data" />
      ) : (
        <div className="p-4">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between py-1.5 border-b border-ink/[0.05] last:border-0 text-[12px]">
              <span className="text-ink/60">{k}</span>
              <span className="text-ink/80">{fmtCurrencyFull(v)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * Keuangan Loonars Excellent Living -- terpisah total dari angka Private
 * Living. Hanya pendapatan kotor kamar, ADR, dan okupansi dari el_bookings.
 * Bagi hasil investor/MKH belum ada: rumusnya belum ditetapkan owner.
 */
export default function ElKeuanganPage() {
  const [from, setFrom] = useState(awalBulan());
  const [to, setTo] = useState(akhirBulan());
  const [data, setData] = useState<ElFinanceRingkasan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get<ElFinanceRingkasan>(`/el/finance/ringkasan?from=${from}&to=${to}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [from, to]);

  return (
    <FinanceShell pageTitle="Keuangan Excellent Living" pageSub="Pendapatan kamar Loonars Excellent Living">
      <div className="flex flex-wrap gap-4 mb-5 items-end">
        <label className="text-[10px] uppercase tracking-wider text-ink/40">
          Dari
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-ink/40">
          Sampai
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && <div className="mb-4 text-[12px] text-ruby-500">{error}</div>}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <StatCard label="Pendapatan Kotor" value={fmtCurrencyFull(data.pendapatan_kotor)} sub={`${data.jumlah_booking} booking (tgl check-in)`} accent="gold" />
            <StatCard label="Okupansi" value={data.okupansi != null ? `${(data.okupansi * 100).toFixed(1)}%` : "—"} sub={`${data.room_nights_terisi}/${data.room_nights_tersedia} malam kamar`} accent="sage" />
            <StatCard label="ADR" value={data.adr != null ? fmtCurrencyFull(Math.round(data.adr)) : "—"} accent="azure" />
            <StatCard label="Jumlah Kamar" value={String(data.jumlah_kamar)} />
          </div>
          <div className="grid md:grid-cols-2 gap-5 mb-5">
            <Rincian title="Per Sumber" data={data.per_sumber} />
            <Rincian title="Per Tipe Kamar" data={data.per_tipe} />
          </div>
          <Card>
            <CardHeader title="Booking" subtitle="Bagi hasil investor belum dihitung — skemanya belum ditetapkan" />
            {data.bookings.length === 0 ? (
              <Empty label="Belum ada booking pada periode ini" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[9.5px] uppercase tracking-wider text-ink/30">
                      <th className="px-3.5 py-2.5">Check-in</th>
                      <th className="px-3.5 py-2.5">Kamar</th>
                      <th className="px-3.5 py-2.5">Tamu</th>
                      <th className="px-3.5 py-2.5">Sumber</th>
                      <th className="px-3.5 py-2.5">Malam</th>
                      <th className="px-3.5 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bookings.map((b) => (
                      <tr key={b.id} className="border-t border-ink/[0.05]">
                        <td className="px-3.5 py-2.5 text-ink/60 whitespace-nowrap">{b.tgl_checkin}</td>
                        <td className="px-3.5 py-2.5 font-semibold text-ink">{b.room_nomor ?? "—"}</td>
                        <td className="px-3.5 py-2.5 text-ink/70">{b.guest_nama}</td>
                        <td className="px-3.5 py-2.5 text-ink/60">{b.sumber}</td>
                        <td className="px-3.5 py-2.5 text-ink/60">{b.durasi_malam ?? "-"}</td>
                        <td className="px-3.5 py-2.5 text-right text-ink/80 whitespace-nowrap">{fmtCurrencyFull(b.total_bayar)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
