"use client";

import { useEffect, useState } from "react";
import { ExcellentShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrencyFull, fmtDate } from "@/lib/format";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { ElInvestorSaya } from "@/lib/types";

const UNIT_STATUS: Record<string, string> = { tersedia: "Tersedia", dp: "DP", verifikasi: "Menunggu Verifikasi", terjual: "Terjual" };
const TRANSAKSI: Record<string, string> = { booking: "Booking Fee", dp: "Down Payment", akad: "Akad / Lunas" };
const METODE: Record<string, string> = { cash: "Cash", kpr: "KPR", both: "Cash + KPR" };

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-ink/[0.05] last:border-0 text-[12px]">
      <span className="text-ink/40">{label}</span>
      <span className="text-ink/80 text-right">{value}</span>
    </div>
  );
}

/**
 * Dashboard investor Excellent Living. Data unit & pembelian dari Mkhsistem
 * (proyek LNR2). Bagi hasil sengaja belum ditampilkan -- rumusnya belum
 * ditetapkan owner (2026-10-22).
 */
export default function ElInvestorPage() {
  const [data, setData] = useState<ElInvestorSaya | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ElInvestorSaya>("/el/investor/saya").then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const ok = data?.okupansi_bulan_ini;

  return (
    <ExcellentShell pageTitle="Unit Saya" pageSub="Loonars Excellent Living">
      {error && <div className="mb-4 text-[12px] text-ruby-500">{error}</div>}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <StatCard label="Unit Dimiliki" value={String(data.units.length)} accent="gold" />
            <StatCard
              label="Okupansi Bulan Ini"
              value={ok?.okupansi != null ? `${(ok.okupansi * 100).toFixed(1)}%` : "—"}
              sub={ok ? `${ok.room_nights_terisi}/${ok.room_nights_tersedia} malam kamar` : undefined}
              accent="sage"
            />
            <StatCard label="Jumlah Kamar Hotel" value={String(ok?.jumlah_kamar ?? 0)} accent="azure" />
          </div>

          <Card className="mb-5">
            <CardHeader title="Bagi Hasil" />
            <div className="p-4 text-[12px] text-ink/50">Laporan bagi hasil Excellent Living akan tampil di sini setelah skemanya ditetapkan manajemen.</div>
          </Card>

          {data.units.length === 0 ? (
            <Empty label="Akun ini belum ditautkan ke unit Loonars Excellent Living. Hubungi admin." />
          ) : (
            data.units.map((u) => (
              <Card key={u.id} className="mb-4">
                <CardHeader title={`Unit ${u.blok}`} subtitle={[u.tipe, UNIT_STATUS[u.status] ?? u.status].filter(Boolean).join(" · ")} />
                <div className="p-4">
                  {u.luas != null && <Baris label="Luas" value={`${u.luas} m²`} />}
                  {u.pembelian ? (
                    <>
                      <Baris label="Harga" value={fmtCurrencyFull(u.pembelian.price)} />
                      <Baris label="Tahap" value={TRANSAKSI[u.pembelian.transaction_type] ?? u.pembelian.transaction_type} />
                      {u.pembelian.payment_method && <Baris label="Metode Bayar" value={METODE[u.pembelian.payment_method] ?? u.pembelian.payment_method} />}
                      {u.pembelian.booking_fee != null && <Baris label="Booking Fee" value={fmtCurrencyFull(u.pembelian.booking_fee)} />}
                      {u.pembelian.dp_amount != null && <Baris label="DP" value={fmtCurrencyFull(u.pembelian.dp_amount)} />}
                      {u.pembelian.pelunasan_amount != null && <Baris label="Pelunasan" value={fmtCurrencyFull(u.pembelian.pelunasan_amount)} />}
                      {u.pembelian.transaction_date && <Baris label="Tanggal Transaksi" value={fmtDate(u.pembelian.transaction_date)} />}
                      <Baris label="Serah Terima" value={u.pembelian.handover_date ? fmtDate(u.pembelian.handover_date) : "Belum dijadwalkan"} />
                    </>
                  ) : (
                    <div className="text-[12px] text-ink/40">Data pembelian belum tercatat.</div>
                  )}
                </div>
              </Card>
            ))
          )}
        </>
      )}
    </ExcellentShell>
  );
}
