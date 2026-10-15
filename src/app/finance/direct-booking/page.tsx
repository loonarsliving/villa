"use client";

import { useEffect, useMemo, useState } from "react";
import { FinanceShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrencyFull, fmtDate, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { Btn, inputCls } from "@/components/Modal";
import type { FinanceChecklist } from "@/lib/types";

/**
 * Direct booking (permintaan owner 2026-10-15): data finance tentang siapa
 * saja yang booking langsung, bisa dipilih per kategori supaya dapat
 * checklist dana per kategori.
 *
 * Tidak ada endpoint/tabel baru: memakai GET /finance/checklist-dana dan
 * hanya menampilkan baris ber-normalized_channel 'DIRECT'. Centang masuk
 * memakai finance_settlements yang sama dengan Checklist Dana Masuk, jadi
 * status di dua halaman itu selalu sama.
 */

const KATEGORI_LABEL: Record<string, string> = {
  website: "Website (loonars.id)",
  investor: "Menginap Investor",
  kol: "Kupon KOL",
  whatsapp: "WhatsApp",
  "walk-in": "Walk-in",
  google: "Google Hotel Search",
  "late-night": "Late Night",
};
const labelKategori = (k: string) => KATEGORI_LABEL[k] ?? k;

type StatusFilter = "semua" | "belum" | "masuk";

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${ym}-01`, to: last };
}

export default function DirectBookingPage() {
  const [bulan, setBulan] = useState(todayISO().slice(0, 7));
  const [kategori, setKategori] = useState("");
  const [status, setStatus] = useState<StatusFilter>("belum");
  const [cari, setCari] = useState("");
  const [data, setData] = useState<FinanceChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tglMasuk, setTglMasuk] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    const { from, to } = monthRange(bulan);
    api
      .get<FinanceChecklist>(`/finance/checklist-dana?from=${from}&to=${to}`)
      .then((d) => {
        setData(d);
        setSelected(new Set());
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [bulan]);

  const direct = useMemo(() => (data?.items ?? []).filter((i) => i.normalized_channel === "DIRECT"), [data]);

  const perKategori = useMemo(() => {
    const m = new Map<string, { kategori: string; count: number; seharusnya: number; belum: number; countBelum: number }>();
    for (const i of direct) {
      const k = i.sumber ?? "-";
      const r = m.get(k) ?? { kategori: k, count: 0, seharusnya: 0, belum: 0, countBelum: 0 };
      r.count++;
      r.seharusnya += i.seharusnya;
      if (!i.masuk) {
        r.belum += i.seharusnya;
        r.countBelum++;
      }
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.seharusnya - a.seharusnya);
  }, [direct]);

  const items = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return direct.filter(
      (i) =>
        (!kategori || (i.sumber ?? "-") === kategori) &&
        (status === "semua" || (status === "masuk" ? i.masuk : !i.masuk)) &&
        (!q || i.guest_nama.toLowerCase().includes(q)),
    );
  }, [direct, kategori, status, cari]);

  const belumDiList = items.filter((i) => !i.masuk);
  const semuaDipilih = belumDiList.length > 0 && belumDiList.every((i) => selected.has(i.booking_id));
  const selectedTotal = direct.filter((i) => selected.has(i.booking_id)).reduce((a, i) => a + i.seharusnya, 0);
  const totalAktif = perKategori.filter((k) => !kategori || k.kategori === kategori);
  const sum = (f: (k: (typeof perKategori)[number]) => number) => totalAktif.reduce((a, k) => a + f(k), 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      belumDiList.forEach((i) => (semuaDipilih ? next.delete(i.booking_id) : next.add(i.booking_id)));
      return next;
    });
  }

  async function tandai(ids: string[]) {
    if (!ids.length || !tglMasuk) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/finance/settlements/receive-bulk`, { booking_ids: ids, received_date: tglMasuk });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function batalkan(bookingId: string, nama: string) {
    const alasan = window.prompt(`Alasan membatalkan centang untuk ${nama}?`);
    if (!alasan?.trim()) return;
    try {
      await api.post(`/finance/settlements/unreceive`, { booking_id: bookingId, reason: alasan.trim() });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <FinanceShell pageTitle="Direct Booking" pageSub="Siapa saja yang booking langsung, per kategori, dengan checklist dana masuk">
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <label className="text-[10px] text-ink/40">
          Bulan check-in
          <input className={`${inputCls} block`} type="month" value={bulan} onChange={(e) => e.target.value && setBulan(e.target.value)} />
        </label>
        <label className="text-[10px] text-ink/40">
          Kategori
          <select className={`${inputCls} block`} value={kategori} onChange={(e) => setKategori(e.target.value)}>
            <option value="">Semua kategori</option>
            {perKategori.map((k) => (
              <option key={k.kategori} value={k.kategori}>
                {labelKategori(k.kategori)} ({k.count})
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-ink/40">
          Cari nama tamu
          <input className={`${inputCls} block`} value={cari} onChange={(e) => setCari(e.target.value)} placeholder="nama..." />
        </label>
        <div className="flex gap-1">
          {(["belum", "masuk", "semua"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`text-[10.5px] px-3 py-1.5 rounded border ${status === s ? "border-gold-500 text-gold-400" : "border-ink/15 text-ink/50"}`}
            >
              {s === "belum" ? "Belum masuk" : s === "masuk" ? "Sudah masuk" : "Semua"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      {loading && <Loading />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard label="Booking langsung" value={String(sum((k) => k.count))} sub={kategori ? labelKategori(kategori) : "semua kategori"} />
            <StatCard label="Seharusnya masuk" value={fmtCurrencyFull(sum((k) => k.seharusnya))} sub="total bayar" />
            <StatCard
              label="Sudah masuk"
              value={fmtCurrencyFull(sum((k) => k.seharusnya - k.belum))}
              accent="sage"
              sub={`${sum((k) => k.count - k.countBelum)} booking dicentang`}
            />
            <StatCard label="Belum masuk" value={fmtCurrencyFull(sum((k) => k.belum))} sub={`${sum((k) => k.countBelum)} booking belum dicentang`} />
          </div>

          <Card className="mb-4">
            <CardHeader title="Per Kategori" subtitle="Klik baris untuk menampilkan checklist kategori itu" />
            {perKategori.length === 0 ? (
              <Empty label="Tidak ada booking langsung di bulan ini." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-ink/35 text-[9.5px] uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Kategori</th>
                      <th className="text-right px-4 py-2">Booking</th>
                      <th className="text-right px-4 py-2">Seharusnya</th>
                      <th className="text-right px-4 py-2">Belum masuk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perKategori.map((k) => (
                      <tr
                        key={k.kategori}
                        onClick={() => setKategori(kategori === k.kategori ? "" : k.kategori)}
                        className={`border-t border-ink/[0.05] cursor-pointer ${kategori === k.kategori ? "bg-gold-500/10 text-ink" : "text-ink/70"}`}
                      >
                        <td className="px-4 py-2">{labelKategori(k.kategori)}</td>
                        <td className="px-4 py-2 text-right">{k.count}</td>
                        <td className="px-4 py-2 text-right">{fmtCurrencyFull(k.seharusnya)}</td>
                        <td className="px-4 py-2 text-right">
                          {fmtCurrencyFull(k.belum)} <span className="text-ink/30">({k.countBelum})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {selected.size > 0 && (
            <Card className="mb-4 border-gold-500/40">
              <CardHeader title={`${selected.size} booking dipilih · ${fmtCurrencyFull(selectedTotal)}`} subtitle="Tandai sudah masuk rekening" />
              <div className="p-4 flex flex-wrap gap-3 items-end">
                <label className="text-[10px] text-ink/40">
                  Tanggal masuk
                  <input className={`${inputCls} block`} type="date" value={tglMasuk} onChange={(e) => setTglMasuk(e.target.value)} />
                </label>
                <Btn variant="primary" disabled={busy} onClick={() => tandai([...selected])}>
                  Tandai {selected.size} masuk
                </Btn>
                <Btn onClick={() => setSelected(new Set())}>Batal pilih</Btn>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title={`Checklist ${kategori ? labelKategori(kategori) : "Direct Booking"}`}
              subtitle={`Check-in ${fmtDate(data.from)} s/d ${fmtDate(data.to)} yang tanggalnya sudah tiba`}
            />
            {items.length === 0 ? (
              <Empty label="Tidak ada data untuk filter ini." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-ink/35 text-[9.5px] uppercase tracking-wide">
                      <th className="px-3 py-2 w-8">
                        {belumDiList.length > 0 && <input type="checkbox" checked={semuaDipilih} onChange={toggleAll} aria-label="Pilih semua" />}
                      </th>
                      <th className="text-left px-3 py-2">Tamu / Unit</th>
                      <th className="text-left px-3 py-2">Kategori</th>
                      <th className="text-left px-3 py-2">Check-in</th>
                      <th className="text-left px-3 py-2">Check-out</th>
                      <th className="text-right px-3 py-2">Seharusnya</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.booking_id} className="border-t border-ink/[0.05] text-ink/70 align-top">
                        <td className="px-3 py-2">
                          {!i.masuk && (
                            <input type="checkbox" checked={selected.has(i.booking_id)} onChange={() => toggle(i.booking_id)} aria-label={`Pilih ${i.guest_nama}`} />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {i.guest_nama}
                          <div className="text-ink/30 text-[10px]">Unit {i.unit_nomor ?? "-"}</div>
                        </td>
                        <td className="px-3 py-2">{labelKategori(i.sumber ?? "-")}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtDate(i.tgl_checkin)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {fmtDate(i.tgl_checkout)}
                          <div className="text-ink/30 text-[10px]">{i.malam} malam</div>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{fmtCurrencyFull(i.seharusnya)}</td>
                        <td className="px-3 py-2">
                          {i.masuk ? (
                            <>
                              <Badge tone={i.variance_amount ? "danger" : "ok"}>Sudah masuk</Badge>
                              <div className="text-ink/40 text-[10px] mt-0.5">{fmtDate(i.received_date)}</div>
                            </>
                          ) : (
                            <Badge tone="pending">Belum masuk</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {i.masuk ? (
                            <button className="text-[10px] text-ink/40 underline" onClick={() => batalkan(i.booking_id, i.guest_nama)}>
                              Batalkan
                            </button>
                          ) : (
                            <button className="text-[10px] text-gold-400 underline" disabled={busy} onClick={() => tandai([i.booking_id])}>
                              Tandai masuk
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 text-[10.5px] text-ink/35 border-t border-ink/[0.05]">
              Kategori = sumber booking langsung (website, investor, KOL, WhatsApp, walk-in, Google, late night). Centang di sini sama dengan di
              Checklist Dana Masuk. Kalau nilai di mutasi berbeda dari &quot;Seharusnya&quot;, tandai di Checklist Dana Masuk dengan nilai sebenarnya.
            </div>
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
