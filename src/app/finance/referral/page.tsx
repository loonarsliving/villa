"use client";

import { useEffect, useMemo, useState } from "react";
import { FinanceShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrencyFull, fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Empty, Badge } from "@/components/Card";
import type { ReferralFeesResponse, ReferralFeeStatus, ReferralRedemptionRow } from "@/lib/types";

const STATUS_LABEL: Record<ReferralFeeStatus, string> = {
  menunggu_lunas: "Menunggu lunas",
  sah: "Sah",
  gugur: "Gugur (batal)",
};
const STATUS_TONE: Record<ReferralFeeStatus, "ok" | "pending" | "danger"> = {
  menunggu_lunas: "pending",
  sah: "ok",
  gugur: "danger",
};

/**
 * Fee referral karyawan (owner 2026-10-02). Kodenya dibuat Vando dari
 * Mkhsistem dan dipakai tamu di loonars.id; tamu dapat diskon 10% dan
 * karyawan pemilik kode dapat fee sebesar diskon itu, SAH setelah tamu
 * lunas. Status sah/gugur dihitung villa-api dari status booking, tidak
 * disimpan, jadi halaman ini tidak pernah bisa berbeda dari kalender.
 */
export default function ReferralFeesPage() {
  const [data, setData] = useState<ReferralFeesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filterKaryawan, setFilterKaryawan] = useState("");

  function load() {
    setLoading(true);
    api
      .get<ReferralFeesResponse>(`/finance/referral-fees`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function tandai(row: ReferralRedemptionRow, dibayar: boolean) {
    if (dibayar && !confirm(`Tandai fee ${fmtCurrencyFull(row.fee)} untuk ${row.employee_nama} sudah dicairkan?`)) return;
    setBusyId(row.id);
    try {
      await api.post(`/finance/referral-fees/paid`, { id: row.id, dibayar });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  // Rekap per karyawan -- satu karyawan bisa punya lebih dari satu kode.
  const perKaryawan = useMemo(() => {
    const map = new Map<string, { nama: string; kode: string[]; dipakai: number; sah: number; feeSah: number; feeMenunggu: number; feeDibayar: number }>();
    for (const k of data?.kode ?? []) {
      const key = k.employee_id ?? `nama:${k.employee_nama}`;
      const cur = map.get(key) ?? { nama: k.employee_nama, kode: [], dipakai: 0, sah: 0, feeSah: 0, feeMenunggu: 0, feeDibayar: 0 };
      cur.kode.push(k.kode);
      cur.dipakai += k.jumlah_dipakai;
      cur.sah += k.jumlah_sah;
      cur.feeSah += k.fee_sah;
      cur.feeMenunggu += k.fee_menunggu;
      cur.feeDibayar += k.fee_sudah_dibayar;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.feeSah - a.feeSah || b.dipakai - a.dipakai);
  }, [data]);

  const totals = useMemo(() => {
    const t = { feeSah: 0, feeMenunggu: 0, feeDibayar: 0, diskon: 0, booking: 0 };
    for (const p of data?.pemakaian ?? []) {
      if (p.status_fee === "gugur") continue;
      t.booking += 1;
      t.diskon += Number(p.diskon);
      if (p.status_fee === "sah") {
        t.feeSah += Number(p.fee);
        if (p.fee_dibayar_at) t.feeDibayar += Number(p.fee);
      } else {
        t.feeMenunggu += Number(p.fee);
      }
    }
    return t;
  }, [data]);

  const pemakaian = (data?.pemakaian ?? []).filter((p) => !filterKaryawan || p.employee_nama === filterKaryawan);

  return (
    <FinanceShell pageTitle="Fee Referral" pageSub="Kode referral karyawan: diskon tamu 10%, fee karyawan sebesar diskon, sah setelah tamu lunas">
      {loading && !data && <Loading />}
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Fee sah (belum dicairkan)" value={fmtCurrencyFull(totals.feeSah - totals.feeDibayar)} />
            <Stat label="Fee sudah dicairkan" value={fmtCurrencyFull(totals.feeDibayar)} />
            <Stat label="Fee menunggu tamu lunas" value={fmtCurrencyFull(totals.feeMenunggu)} />
            <Stat label="Booking via referral" value={String(totals.booking)} />
          </div>

          <Card>
            <CardHeader title="Rekap per karyawan" subtitle="Siapa yang kodenya dipakai, dan berapa fee-nya" />
            {perKaryawan.length === 0 ? (
              <Empty label="Belum ada kode referral. Kode dibuat Vando dari Mkhsistem." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-ink/40 border-b border-ink/10">
                      <th className="px-4 py-2">Karyawan</th>
                      <th className="px-3 py-2">Kode</th>
                      <th className="px-3 py-2 text-right">Dipakai</th>
                      <th className="px-3 py-2 text-right">Lunas</th>
                      <th className="px-3 py-2 text-right">Fee sah</th>
                      <th className="px-3 py-2 text-right">Sudah dicairkan</th>
                      <th className="px-3 py-2 text-right">Menunggu lunas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perKaryawan.map((k) => (
                      <tr
                        key={k.nama + k.kode.join()}
                        className={`border-b border-ink/5 cursor-pointer ${filterKaryawan === k.nama ? "bg-ink/[0.04]" : ""}`}
                        onClick={() => setFilterKaryawan(filterKaryawan === k.nama ? "" : k.nama)}
                      >
                        <td className="px-4 py-2.5 font-medium text-ink/80">{k.nama}</td>
                        <td className="px-3 py-2.5 font-mono text-[10px]">{k.kode.join(", ")}</td>
                        <td className="px-3 py-2.5 text-right">{k.dipakai}</td>
                        <td className="px-3 py-2.5 text-right">{k.sah}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">{fmtCurrencyFull(k.feeSah)}</td>
                        <td className="px-3 py-2.5 text-right">{fmtCurrencyFull(k.feeDibayar)}</td>
                        <td className="px-3 py-2.5 text-right text-ink/50">{fmtCurrencyFull(k.feeMenunggu)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title={filterKaryawan ? `Pemakaian kode — ${filterKaryawan}` : "Pemakaian kode"}
              subtitle="Satu baris per booking yang memakai kode referral"
              action={
                filterKaryawan && (
                  <button onClick={() => setFilterKaryawan("")} className="text-[10px] font-semibold text-ink/50 border border-ink/15 rounded px-2.5 py-1.5">
                    Tampilkan semua
                  </button>
                )
              }
            />
            {pemakaian.length === 0 ? (
              <Empty label="Belum ada booking yang memakai kode referral." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-ink/40 border-b border-ink/10">
                      <th className="px-4 py-2">Tanggal pesan</th>
                      <th className="px-3 py-2">Karyawan</th>
                      <th className="px-3 py-2">Kode</th>
                      <th className="px-3 py-2">Tamu</th>
                      <th className="px-3 py-2">Menginap</th>
                      <th className="px-3 py-2 text-right">Harga normal</th>
                      <th className="px-3 py-2 text-right">Diskon</th>
                      <th className="px-3 py-2 text-right">Fee</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Pencairan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pemakaian.map((p) => (
                      <tr key={p.id} className="border-b border-ink/5">
                        <td className="px-4 py-2.5 text-ink/50">{fmtDateTime(p.created_at)}</td>
                        <td className="px-3 py-2.5 font-medium text-ink/80">{p.employee_nama}</td>
                        <td className="px-3 py-2.5 font-mono text-[10px]">{p.kode}</td>
                        <td className="px-3 py-2.5">{p.guest_nama ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          {p.tgl_checkin ? `${fmtDate(p.tgl_checkin)} · ${p.malam ?? "?"} mlm` : "—"}
                          {p.unit_nomor && <span className="text-ink/40"> · Unit {p.unit_nomor}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">{fmtCurrencyFull(p.harga_normal)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {fmtCurrencyFull(p.diskon)} <span className="text-ink/40">({Number(p.diskon_persen)}%)</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">{fmtCurrencyFull(p.fee)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={STATUS_TONE[p.status_fee]}>{STATUS_LABEL[p.status_fee]}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          {p.status_fee !== "sah" ? (
                            <span className="text-ink/30">—</span>
                          ) : p.fee_dibayar_at ? (
                            <span className="text-sage-400">
                              Dicairkan {fmtDate(p.fee_dibayar_at)}{" "}
                              <button disabled={busyId === p.id} onClick={() => tandai(p, false)} className="text-ink/40 underline ml-1">
                                batalkan
                              </button>
                            </span>
                          ) : (
                            <button
                              disabled={busyId === p.id}
                              onClick={() => tandai(p, true)}
                              className="text-[10px] font-semibold text-ink/60 border border-ink/15 rounded px-2 py-1"
                            >
                              Tandai dicairkan
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </FinanceShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <div className="text-[10px] text-ink/40 uppercase tracking-wide">{label}</div>
        <div className="text-base font-semibold text-ink/85 mt-1">{value}</div>
      </CardBody>
    </Card>
  );
}
