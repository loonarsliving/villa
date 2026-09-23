"use client";

import { useEffect, useMemo, useState } from "react";
import { FinanceShell } from "./_shell";
import { SurvivalControlCenter } from "./_SurvivalControlCenter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency, fmtCurrencyFull, fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { addDaysISO } from "@/lib/stayDates";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type {
  FinanceSummary,
  FinanceChannelBreakdown,
  FinanceBookingList,
  FinanceBookingRow,
  FinanceBookingDetail,
  FinanceAuditLogRow,
} from "@/lib/types";

/**
 * Loonars Finance dashboard. Built strictly on what this system can
 * actually verify (see the module comment in villa-api ahead of
 * calculateExpectedSettlement()): Cloudbeds only supplies a reservation
 * grand total, never a separate payment/refund/settlement feed. Every
 * number here is traceable to Cloudbeds' reservation sync, this app's own
 * booking workflow status, or a manual Finance action (settlement
 * processing / mark-received) -- never a fabricated figure. Where the
 * underlying data genuinely doesn't exist, the UI says so explicitly
 * (NOT_AVAILABLE / NOT VERIFIED / UNKNOWN) rather than guessing.
 */

type Preset = "today" | "yesterday" | "week" | "month" | "last_month" | "custom";

function presetRange(preset: Preset): { from: string; to: string } {
  const today = todayISO();
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const y = addDaysISO(today, -1);
    return { from: y, to: y };
  }
  if (preset === "week") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=Sun
    const mondayOffset = dow === 0 ? -6 : -(dow - 1);
    return { from: addDaysISO(today, mondayOffset), to: today };
  }
  if (preset === "last_month") {
    const [y, m] = today.slice(0, 7).split("-").map(Number);
    const prevTotal = y * 12 + (m - 1) - 1;
    const py = Math.floor(prevTotal / 12);
    const pm = (prevTotal % 12) + 1;
    const from = `${py}-${String(pm).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10);
    return { from, to: lastDay };
  }
  // month (default) & custom fallback
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

const PRESET_LABELS: Record<Preset, string> = {
  today: "Hari ini",
  yesterday: "Kemarin",
  week: "Minggu ini",
  month: "Bulan ini",
  last_month: "Bulan lalu",
  custom: "Custom",
};

function toCsv(rows: FinanceBookingRow[]): string {
  const header = ["Tanggal Checkin", "Tanggal Checkout", "Unit", "Tamu", "Sumber", "Channel", "Status", "Revenue", "Status Bayar", "Outstanding", "Status Settlement", "Perkiraan Settlement"];
  const lines = rows.map((r) =>
    [
      r.tgl_checkin,
      r.tgl_checkout ?? "",
      r.unit_nomor,
      r.guest_nama,
      r.sumber,
      r.normalized_channel,
      r.status,
      r.revenue,
      r.payment_status,
      r.outstanding,
      r.settlement_status ?? "",
      r.expected_settlement_date ?? "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const alertTone: Record<string, "ok" | "pending" | "danger"> = {
  info: "pending",
  warning: "pending",
  danger: "danger",
};

export default function FinancePage() {
  const { user } = useAuth();
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [sumberFilter, setSumberFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");
  const [settlementStatusFilter, setSettlementStatusFilter] = useState("");
  const [q, setQ] = useState("");

  const range = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset);

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [channels, setChannels] = useState<FinanceChannelBreakdown | null>(null);
  const [bookings, setBookings] = useState<FinanceBookingList | null>(null);
  const [auditLog, setAuditLog] = useState<FinanceAuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    const bookingQs = new URLSearchParams({ from: range.from, to: range.to, limit: "100" });
    if (sumberFilter) bookingQs.set("sumber", sumberFilter);
    if (paymentStatusFilter) bookingQs.set("payment_status", paymentStatusFilter);
    if (settlementStatusFilter) bookingQs.set("settlement_status", settlementStatusFilter);
    if (q) bookingQs.set("q", q);

    Promise.all([
      api.get<FinanceSummary>(`/finance/summary?${qs}`),
      api.get<FinanceChannelBreakdown>(`/finance/channel-breakdown?${qs}`),
      api.get<FinanceBookingList>(`/finance/bookings?${bookingQs}`),
      api.get<FinanceAuditLogRow[]>(`/finance/audit-log?limit=15`),
    ])
      .then(([s, c, b, a]) => {
        setSummary(s);
        setChannels(c);
        setBookings(b);
        setAuditLog(a);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [preset, customFrom, customTo, sumberFilter, paymentStatusFilter, settlementStatusFilter, q]);

  function refreshAfterAction() {
    load();
  }

  const sumberOptions = useMemo(() => (channels?.channels ?? []).map((c) => c.sumber), [channels]);

  return (
    <FinanceShell pageTitle="Finance" pageSub="Cloudbeds → OTA → Direct Booking → Settlement → Cash">
      <SurvivalControlCenter from={range.from} to={range.to} />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(PRESET_LABELS) as Preset[])
          .filter((p) => p !== "custom")
          .map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition ${
                preset === p ? "bg-ink text-base-900 border-ink" : "border-ink/15 text-ink/60 hover:border-ink/30"
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        <input
          type="date"
          className="text-[11px] px-2 py-1.5 rounded-full border border-ink/15 bg-transparent"
          value={customFrom}
          onChange={(e) => {
            setCustomFrom(e.target.value);
            setPreset("custom");
          }}
        />
        <span className="text-ink/30 text-[11px] self-center">s/d</span>
        <input
          type="date"
          className="text-[11px] px-2 py-1.5 rounded-full border border-ink/15 bg-transparent"
          value={customTo}
          onChange={(e) => {
            setCustomTo(e.target.value);
            setPreset("custom");
          }}
        />
        <select className="text-[11px] px-2 py-1.5 rounded-full border border-ink/15 bg-transparent" value={sumberFilter} onChange={(e) => setSumberFilter(e.target.value)}>
          <option value="">Semua channel</option>
          {sumberOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="text-[11px] px-2 py-1.5 rounded-full border border-ink/15 bg-transparent" value={paymentStatusFilter} onChange={(e) => setPaymentStatusFilter(e.target.value)}>
          <option value="">Semua status bayar</option>
          <option value="PAID">Sudah bayar</option>
          <option value="UNPAID">Belum bayar</option>
          <option value="CANCELLED">Dibatalkan</option>
        </select>
        <select className="text-[11px] px-2 py-1.5 rounded-full border border-ink/15 bg-transparent" value={settlementStatusFilter} onChange={(e) => setSettlementStatusFilter(e.target.value)}>
          <option value="">Semua status settlement</option>
          <option value="PENDING">Pending</option>
          <option value="READY_TO_COLLECT">Siap dicairkan</option>
          <option value="PROCESSING">Diproses</option>
          <option value="RECEIVED">Sudah diterima</option>
        </select>
        <input
          className="text-[11px] px-2 py-1.5 rounded-full border border-ink/15 bg-transparent min-w-[140px]"
          placeholder="Cari tamu..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading && <Loading />}
      {error && <div className="text-ruby-500 text-xs px-1 py-3">Gagal memuat: {error}</div>}

      {!loading && !error && summary && (
        <>
          {/* Alerts */}
          {summary.alerts.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {summary.alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <Badge tone={alertTone[a.level] ?? "pending"}>{a.type}</Badge>
                  <span className="text-ink/60">{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* 6 summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <StatCard label="Gross Revenue" value={fmtCurrency(summary.gross_revenue)} accent="azure" />
            <StatCard label="Net Revenue" value={fmtCurrency(summary.net_revenue)} accent="azure" sub={summary.net_revenue_note} />
            <StatCard
              label="Payment Received"
              value={fmtCurrency(summary.payment_received)}
              accent="sage"
              sub={`${summary.cloudbeds_balance_verified_count}/${summary.bookings_counted} booking terverifikasi dari Cloudbeds`}
            />
            <StatCard label="Outstanding" value={fmtCurrency(summary.outstanding)} accent={summary.outstanding > 0 ? "ruby" : "sage"} />
            <StatCard label="OTA Receivable" value={fmtCurrency(summary.ota_receivable)} accent="gold" />
            <StatCard
              label="Cash Received"
              value={summary.cash_received.verified ? fmtCurrency(summary.cash_received.amount) : "NOT VERIFIED"}
              accent={summary.cash_received.verified ? "sage" : "neutral"}
              sub={summary.cash_received.note}
            />
          </div>

          <Card className="mb-4">
            <CardHeader title="Catatan data" subtitle="Batasan integrasi Cloudbeds saat ini" />
            <div className="p-4 sm:p-5 text-[10.5px] text-ink/50 space-y-1">
              {summary.data_caveats.map((c, i) => (
                <div key={i}>• {c}</div>
              ))}
              <div>
                Aktivitas Cloudbeds terakhir:{" "}
                <strong className="text-ink/70">{summary.last_cloudbeds_activity ? fmtDateTime(summary.last_cloudbeds_activity) : "belum ada"}</strong>
              </div>
            </div>
          </Card>

          {/* Channel breakdown */}
          {channels && (
            <Card className="mb-4">
              <CardHeader title="Revenue by Channel" subtitle={`${range.from} s/d ${range.to}`} />
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-ink/40 border-b border-ink/10">
                      <th className="px-4 py-2">Channel</th>
                      <th className="px-3 py-2">Room Nights</th>
                      <th className="px-3 py-2">Gross Revenue</th>
                      <th className="px-3 py-2">OTA Deduction</th>
                      <th className="px-3 py-2">Net Revenue</th>
                      <th className="px-3 py-2">Avg Net ADR</th>
                      <th className="px-3 py-2">Outstanding</th>
                      <th className="px-3 py-2">Settlement</th>
                      <th className="px-3 py-2">Bank Tujuan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.channels.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-6 text-center text-ink/30">
                          Tidak ada data pada periode ini.
                        </td>
                      </tr>
                    )}
                    {channels.channels.map((c) => (
                      <tr key={c.sumber} className="border-b border-ink/5">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-ink/80">{c.sumber}</div>
                          <div className="text-ink/30">
                            {c.normalized_channel} · {c.booking_count} booking
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{c.room_nights}</td>
                        <td className="px-3 py-2.5">{fmtCurrencyFull(c.revenue)}</td>
                        <td className="px-3 py-2.5 text-ruby-500">{c.ota_deduction > 0 ? `−${fmtCurrencyFull(c.ota_deduction)}` : "—"}</td>
                        <td className="px-3 py-2.5 font-medium">{fmtCurrencyFull(c.net_revenue)}</td>
                        <td className="px-3 py-2.5">{c.avg_net_adr != null ? fmtCurrencyFull(c.avg_net_adr) : "—"}</td>
                        <td className="px-3 py-2.5">{fmtCurrencyFull(c.outstanding)}</td>
                        <td className="px-3 py-2.5">
                          {c.settled_count}/{c.settled_count + c.unsettled_count} diterima
                        </td>
                        <td className="px-3 py-2.5 text-ink/50">{c.destination_account ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  {channels.channels.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-ink/10 font-semibold text-ink/70">
                        <td className="px-4 py-2.5">Total</td>
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5">{fmtCurrencyFull(channels.totals.revenue)}</td>
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5">{fmtCurrencyFull(channels.totals.net_revenue)}</td>
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5">{fmtCurrencyFull(channels.totals.outstanding)}</td>
                        <td className="px-3 py-2.5" colSpan={2}>
                          OTA Receivable: {fmtCurrencyFull(channels.totals.ota_receivable)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          )}

          {/* Booking list */}
          <Card className="mb-4">
            <CardHeader
              title="Transaksi"
              subtitle={bookings ? `${bookings.total} booking` : undefined}
              action={
                bookings && (
                  <button
                    onClick={() => downloadCsv(`finance-transactions-${range.from}_${range.to}.csv`, toCsv(bookings.items))}
                    className="text-[10px] font-semibold text-ink/50 border border-ink/15 rounded px-2.5 py-1.5"
                  >
                    Export CSV
                  </button>
                )
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-ink/40 border-b border-ink/10">
                    <th className="px-4 py-2">Checkin</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2">Tamu</th>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">Revenue</th>
                    <th className="px-3 py-2">Bayar</th>
                    <th className="px-3 py-2">Settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {(!bookings || bookings.items.length === 0) && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-ink/30">
                        Tidak ada booking pada filter ini.
                      </td>
                    </tr>
                  )}
                  {bookings?.items.map((b) => (
                    <tr
                      key={b.id}
                      className="border-b border-ink/5 cursor-pointer hover:bg-ink/[0.03]"
                      onClick={() => setDetailId(b.id)}
                    >
                      <td className="px-4 py-2.5">{fmtDate(b.tgl_checkin)}</td>
                      <td className="px-3 py-2.5">{b.unit_nomor}</td>
                      <td className="px-3 py-2.5">{b.guest_nama}</td>
                      <td className="px-3 py-2.5">{b.normalized_channel}</td>
                      <td className="px-3 py-2.5">{fmtCurrencyFull(b.revenue)}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={b.payment_status === "PAID" ? "ok" : b.payment_status === "CANCELLED" ? "pending" : "danger"}>
                          {b.payment_status}
                        </Badge>
                        <div className="text-ink/30 text-[9.5px] mt-0.5">
                          {b.payment_status_source === "cloudbeds_balance" ? "dari Cloudbeds" : "perkiraan"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {b.settlement_status ? (
                          <Badge tone={b.settlement_status === "RECEIVED" ? "ok" : "pending"}>{b.settlement_status}</Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Audit trail */}
          <Card>
            <CardHeader title="Audit Trail" subtitle="15 perubahan manual Finance terbaru" />
            {auditLog.length === 0 ? (
              <Empty label="Belum ada perubahan manual." />
            ) : (
              <div className="divide-y divide-ink/5">
                {auditLog.map((a) => (
                  <div key={a.id} className="px-4 sm:px-5 py-3 text-[11px]">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-ink/80">{a.action}</span>
                      <span className="text-ink/30">{fmtDateTime(a.created_at)}</span>
                    </div>
                    <div className="text-ink/40 mt-0.5">
                      {a.user_nama ?? "—"} {a.reason ? `— ${a.reason}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {detailId && (
        <BookingDetailModal
          id={detailId}
          canProcess={user?.role === "finance" || user?.role === "admin"}
          onClose={() => setDetailId(null)}
          onChanged={refreshAfterAction}
        />
      )}
    </FinanceShell>
  );
}

function BookingDetailModal({
  id,
  canProcess,
  onClose,
  onChanged,
}: {
  id: string;
  canProcess: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<FinanceBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [settlementRef, setSettlementRef] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [bankRef, setBankRef] = useState("");
  const [note, setNote] = useState("");

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<FinanceBookingDetail>(`/finance/booking?id=${id}`)
      .then((d) => {
        setDetail(d);
        setAmountReceived(String(d.revenue.room ?? ""));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  async function process() {
    setBusy(true);
    try {
      await api.post(`/finance/settlements/process`, { booking_id: id, settlement_reference: settlementRef || undefined });
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function markReceived() {
    if (!amountReceived || !receivedDate) return;
    setBusy(true);
    try {
      await api.post(`/finance/settlements/receive`, {
        booking_id: id,
        amount_received: Number(amountReceived),
        received_date: receivedDate,
        bank_reference: bankRef || undefined,
        notes: note || undefined,
      });
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={detail ? detail.reservation.guest_nama : "Detail Booking"} onClose={onClose} wide footer={<Btn onClick={onClose}>Tutup</Btn>}>
      {loading && <Loading />}
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      {detail && (
        <div className="space-y-5 text-[12px]">
          <section>
            <div className="text-[10px] font-semibold text-ink/30 tracking-wide uppercase mb-1.5">Reservasi</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-ink/70">
              <div>Booking ID: {detail.reservation.id.slice(0, 8)}</div>
              <div>Sumber: {detail.reservation.sumber} ({detail.reservation.normalized_channel})</div>
              <div>Checkin: {fmtDate(detail.reservation.tgl_checkin)}</div>
              <div>Checkout: {fmtDate(detail.reservation.tgl_checkout)}</div>
              <div>Unit: {detail.reservation.unit_nomor}</div>
              <div>Status: {detail.reservation.status}</div>
              <div>Cloudbeds ID: {detail.reservation.cloudbeds_reservation_id ?? "—"}</div>
              <div>Tamu: {detail.reservation.guests?.hp ?? "—"}</div>
            </div>
          </section>

          <section>
            <div className="text-[10px] font-semibold text-ink/30 tracking-wide uppercase mb-1.5">Revenue</div>
            <div className="text-ink/70">
              Net: {fmtCurrencyFull(detail.revenue.net)}
              <div className="text-ink/30 text-[10.5px] mt-1">{detail.revenue.note}</div>
            </div>
          </section>

          <section>
            <div className="text-[10px] font-semibold text-ink/30 tracking-wide uppercase mb-1.5">Payment</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-ink/70">
              <div>Status: {detail.payment.paid ? "Lunas" : "Belum lunas"}</div>
              <div>Outstanding: {fmtCurrencyFull(detail.payment.outstanding)}</div>
              <div className="col-span-2 text-ink/40 text-[10.5px]">
                Sumber:{" "}
                {detail.payment.source === "cloudbeds_balance"
                  ? `Saldo asli Cloudbeds (${fmtCurrencyFull(detail.payment.cloudbeds_balance)} belum dibayar)`
                  : "Perkiraan dari status booking, belum tersinkron dari Cloudbeds"}
              </div>
            </div>
          </section>

          <section>
            <div className="text-[10px] font-semibold text-ink/30 tracking-wide uppercase mb-1.5">Settlement</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-ink/70">
              <div>Collection Method: {detail.settlement.collection_method}</div>
              <div>Status: {detail.settlement.settlement_status ?? "—"}</div>
              <div>
                Perkiraan cair: {detail.settlement.expected_settlement_date ? fmtDate(detail.settlement.expected_settlement_date) : "UNKNOWN"}
                {" "}({detail.settlement.settlement_confidence ?? "UNKNOWN"})
              </div>
              <div>Referensi: {detail.settlement.settlement_reference ?? "—"}</div>
              <div>Tujuan Rekening: {detail.settlement.destination_account ?? "—"}</div>
            </div>
          </section>

          <section>
            <div className="text-[10px] font-semibold text-ink/30 tracking-wide uppercase mb-1.5">Bank</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-ink/70">
              <div>Diterima: {detail.bank.amount_received != null ? fmtCurrencyFull(detail.bank.amount_received) : "—"}</div>
              <div>Tanggal: {detail.bank.received_date ? fmtDate(detail.bank.received_date) : "—"}</div>
              <div>Referensi Bank: {detail.bank.bank_reference ?? "—"}</div>
              <div>
                Rekonsiliasi:{" "}
                {detail.bank.reconciliation_status ? (
                  <Badge tone={detail.bank.reconciliation_status === "MATCHED" ? "ok" : "danger"}>{detail.bank.reconciliation_status}</Badge>
                ) : (
                  "—"
                )}
                {detail.bank.variance_amount ? ` (${fmtCurrencyFull(detail.bank.variance_amount)})` : ""}
              </div>
            </div>
          </section>

          {canProcess && detail.settlement.settlement_status !== "RECEIVED" && (
            <section className="border-t border-ink/10 pt-4 space-y-4">
              <div className="text-[10px] font-semibold text-ink/30 tracking-wide uppercase">Aksi Settlement</div>
              {(detail.settlement.settlement_status === "READY_TO_COLLECT" || detail.settlement.settlement_status === "PENDING") && (
                <div className="flex gap-2 items-end">
                  <Field label="Referensi Settlement (opsional)">
                    <input className={inputCls} value={settlementRef} onChange={(e) => setSettlementRef(e.target.value)} />
                  </Field>
                  <Btn variant="primary" disabled={busy} onClick={process}>
                    Process Settlement
                  </Btn>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Jumlah Diterima">
                  <input className={inputCls} type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
                </Field>
                <Field label="Tanggal Diterima">
                  <input className={inputCls} type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
                </Field>
                <Field label="Referensi Bank">
                  <input className={inputCls} value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
                </Field>
                <Field label="Catatan">
                  <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
              <Btn variant="primary" disabled={busy} onClick={markReceived}>
                Mark as Received
              </Btn>
            </section>
          )}

          {detail.audit_log.length > 0 && (
            <section className="border-t border-ink/10 pt-4">
              <div className="text-[10px] font-semibold text-ink/30 tracking-wide uppercase mb-1.5">Riwayat Perubahan</div>
              <div className="space-y-1.5">
                {detail.audit_log.map((a) => (
                  <div key={a.id} className="text-[10.5px] text-ink/50">
                    {fmtDateTime(a.created_at)} — {a.action} oleh {a.user_nama ?? "—"} {a.reason ? `(${a.reason})` : ""}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
