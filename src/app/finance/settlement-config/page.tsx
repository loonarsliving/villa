"use client";

import { useEffect, useState } from "react";
import { FinanceShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { FinanceOtaSettlementConfig, CollectionMethod, SettlementBasis, SettlementSchedule } from "@/lib/types";

const COLLECTION_METHODS: CollectionMethod[] = ["DIRECT_PAYMENT", "OTA_COLLECT", "VCC", "PAY_AT_PROPERTY", "PAYMENT_GATEWAY", "UNKNOWN"];
const SETTLEMENT_BASES: { value: SettlementBasis; label: string }[] = [
  { value: "CHECKOUT", label: "Checkout (mis. Booking.com, Agoda)" },
  { value: "CHECKIN", label: "Checkin (mis. Airbnb — dana dirilis ~24 jam setelah tamu checkin)" },
];
const SETTLEMENT_SCHEDULES: { value: SettlementSchedule; label: string }[] = [
  { value: "FIXED_DELAY", label: "Delay tetap (N hari setelah basis)" },
  { value: "MONTHLY_1ST", label: "Bulanan, tanggal 1 (mis. Booking.com)" },
  { value: "WEEKLY_ON_DAY", label: "Mingguan, hari tertentu (mis. Traveloka)" },
];
const WEEKDAY_LABELS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/**
 * OTA settlement configuration -- per the mandate, write access is
 * OWNER/ADMIN only (mapped to this app's 'admin' role, labelled "Business
 * Owner"). Finance can view so they know the collection method and
 * destination account, but cannot change delay days or accounts.
 *
 * No delay is ever preset for a channel: an admin must type it in from
 * the actual OTA contract/account terms. Leaving it blank keeps
 * calculateExpectedSettlement() honestly returning UNKNOWN for that
 * channel rather than a guessed date.
 */
export default function SettlementConfigPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState<FinanceOtaSettlementConfig[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<FinanceOtaSettlementConfig> | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get<FinanceOtaSettlementConfig[]>(`/finance/ota-settlement-config`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function save() {
    if (!editing?.sumber) return;
    setBusy(true);
    try {
      await api.post(`/finance/ota-settlement-config`, editing);
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FinanceShell pageTitle="Konfigurasi Settlement OTA" pageSub="Collection method, delay settlement, dan rekening tujuan per channel">
      {loading && <Loading />}
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      {!loading && (
        <Card>
          <CardHeader
            title="Channel"
            action={
              isAdmin && (
                <button
                  onClick={() => setEditing({ sumber: "", collection_method: "UNKNOWN", currency: "IDR", settlement_basis: "CHECKOUT", settlement_schedule: "FIXED_DELAY" })}
                  className="text-[10px] font-semibold text-ink/50 border border-ink/15 rounded px-2.5 py-1.5"
                >
                  + Tambah / Ubah
                </button>
              )
            }
          />
          {(!rows || rows.length === 0) && <Empty label="Belum ada konfigurasi settlement. Setiap booking akan bertanda UNKNOWN sampai admin mengisi ini." />}
          {rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-ink/40 border-b border-ink/10">
                    <th className="px-4 py-2">Sumber</th>
                    <th className="px-3 py-2">Collection Method</th>
                    <th className="px-3 py-2">Jadwal</th>
                    <th className="px-3 py-2">Basis</th>
                    <th className="px-3 py-2">Rekening Tujuan</th>
                    <th className="px-3 py-2">Berlaku Sejak</th>
                    <th className="px-3 py-2">Diubah</th>
                    {isAdmin && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sumber} className="border-b border-ink/5">
                      <td className="px-4 py-2.5 font-medium text-ink/80">{r.sumber}</td>
                      <td className="px-3 py-2.5">{r.collection_method}</td>
                      <td className="px-3 py-2.5">
                        {r.settlement_schedule === "MONTHLY_1ST"
                          ? "Bulanan, tgl 1"
                          : r.settlement_schedule === "WEEKLY_ON_DAY"
                            ? r.settlement_weekday != null
                              ? `Mingguan, tiap ${WEEKDAY_LABELS[r.settlement_weekday]}`
                              : "Mingguan (hari belum diisi)"
                            : r.settlement_delay_days != null
                              ? `${r.settlement_delay_days} hari`
                              : "Belum dikonfigurasi"}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.settlement_schedule !== "FIXED_DELAY" || r.settlement_delay_days != null
                          ? r.settlement_basis === "CHECKIN"
                            ? "sejak checkin"
                            : "sejak checkout"
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5">{r.destination_account_label ?? "—"}</td>
                      <td className="px-3 py-2.5">{r.effective_date ?? "—"}</td>
                      <td className="px-3 py-2.5 text-ink/40">{fmtDateTime(r.updated_at)}</td>
                      {isAdmin && (
                        <td className="px-3 py-2.5">
                          <button onClick={() => setEditing(r)} className="text-ink/50 underline">
                            Ubah
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {editing && (
        <Modal
          open
          title={editing.id ? `Ubah — ${editing.sumber}` : "Tambah Konfigurasi"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Btn onClick={() => setEditing(null)}>Batal</Btn>
              <Btn variant="primary" disabled={busy || !editing.sumber} onClick={save}>
                Simpan
              </Btn>
            </>
          }
        >
          <Field label="Sumber (harus persis sama dengan nilai bookings.sumber, mis. booking.com, airbnb, agoda)">
            <input
              className={inputCls}
              value={editing.sumber ?? ""}
              disabled={!!editing.id}
              onChange={(e) => setEditing({ ...editing, sumber: e.target.value })}
            />
          </Field>
          <Field label="Collection Method">
            <select
              className={inputCls}
              value={editing.collection_method ?? "UNKNOWN"}
              onChange={(e) => setEditing({ ...editing, collection_method: e.target.value as CollectionMethod })}
            >
              {COLLECTION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jadwal Pembayaran">
            <select
              className={inputCls}
              value={editing.settlement_schedule ?? "FIXED_DELAY"}
              onChange={(e) => setEditing({ ...editing, settlement_schedule: e.target.value as SettlementSchedule })}
            >
              {SETTLEMENT_SCHEDULES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          {(editing.settlement_schedule ?? "FIXED_DELAY") === "FIXED_DELAY" && (
            <Field label="Delay Settlement (jumlah hari — kosongkan jika belum dikonfirmasi OTA/kontrak)">
              <input
                className={inputCls}
                type="number"
                value={editing.settlement_delay_days ?? ""}
                onChange={(e) => setEditing({ ...editing, settlement_delay_days: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
          )}
          {editing.settlement_schedule === "WEEKLY_ON_DAY" && (
            <Field label="Hari Pembayaran">
              <select
                className={inputCls}
                value={editing.settlement_weekday ?? ""}
                onChange={(e) => setEditing({ ...editing, settlement_weekday: e.target.value === "" ? null : Number(e.target.value) })}
              >
                <option value="">Pilih hari</option>
                {WEEKDAY_LABELS.map((label, idx) => (
                  <option key={idx} value={idx}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Basis tanggal">
            <select
              className={inputCls}
              value={editing.settlement_basis ?? "CHECKOUT"}
              onChange={(e) => setEditing({ ...editing, settlement_basis: e.target.value as SettlementBasis })}
            >
              {SETTLEMENT_BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label Rekening Tujuan (mis. Mandiri ****1234 — jangan nomor lengkap)">
            <input className={inputCls} value={editing.destination_account_label ?? ""} onChange={(e) => setEditing({ ...editing, destination_account_label: e.target.value })} />
          </Field>
          <Field label="Berlaku Sejak">
            <input className={inputCls} type="date" value={editing.effective_date ?? ""} onChange={(e) => setEditing({ ...editing, effective_date: e.target.value })} />
          </Field>
          <Field label="Catatan">
            <input className={inputCls} value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </Field>
        </Modal>
      )}
    </FinanceShell>
  );
}
