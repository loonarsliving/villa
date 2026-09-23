"use client";

import { useEffect, useState } from "react";
import { FinanceShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrencyFull, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { FinancePropertyConfig } from "@/lib/types";

/**
 * Business configuration per property -- every number the Survival
 * Control Center and What-If calculator use. Admin-only write, so
 * Loonars 2/3 can be added later as a new row without any code change,
 * and so an owner can update payroll headcount etc. without asking for
 * a redeploy.
 */

const NUMERIC_FIELDS: { key: keyof FinancePropertyConfig; label: string; hint?: string }[] = [
  { key: "total_rooms", label: "Total Kamar" },
  { key: "investor_share_pct", label: "Porsi Investor (desimal, mis. 0.70 = 70%)" },
  { key: "mkh_share_pct", label: "Porsi MKH (desimal, mis. 0.30 = 30%)" },
  { key: "guarantee_per_room", label: "Jaminan per Kamar / Bulan (Rp)" },
  { key: "target_net_adr", label: "Target Net ADR (Rp)" },
  { key: "conservative_net_adr", label: "Net ADR Konservatif (Rp)" },
  { key: "room_electricity_per_night", label: "Listrik Kamar / Malam Terisi (Rp)" },
  { key: "payroll_employee_count", label: "Jumlah Pegawai" },
  { key: "payroll_per_employee", label: "Gaji per Pegawai / Bulan (Rp)" },
];

export default function PropertyConfigPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState<FinancePropertyConfig[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<FinancePropertyConfig> | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get<FinancePropertyConfig[]>(`/finance/property-config`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function save() {
    if (!editing?.property_code) return;
    setBusy(true);
    try {
      await api.post(`/finance/property-config`, editing);
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FinanceShell pageTitle="Konfigurasi Properti" pageSub="Parameter bisnis untuk Survival Control Center & What-If — bukan angka pricing tamu">
      {loading && <Loading />}
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      {!loading && (
        <Card>
          <CardHeader
            title="Properti"
            action={
              isAdmin && (
                <button
                  onClick={() =>
                    setEditing({
                      property_code: "",
                      property_name: "",
                      total_rooms: 13,
                      investor_share_pct: 0.7,
                      mkh_share_pct: 0.3,
                      guarantee_per_room: 5000000,
                      target_net_adr: 500000,
                      conservative_net_adr: 400000,
                      room_electricity_per_night: 20000,
                      payroll_employee_count: 5,
                      payroll_per_employee: 1500000,
                      currency: "IDR",
                    })
                  }
                  className="text-[10px] font-semibold text-ink/50 border border-ink/15 rounded px-2.5 py-1.5"
                >
                  + Tambah Properti
                </button>
              )
            }
          />
          {(!rows || rows.length === 0) && <Empty label="Belum ada konfigurasi properti." />}
          {rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-ink/40 border-b border-ink/10">
                    <th className="px-4 py-2">Properti</th>
                    <th className="px-3 py-2">Kamar</th>
                    <th className="px-3 py-2">Split</th>
                    <th className="px-3 py-2">Jaminan/Kamar</th>
                    <th className="px-3 py-2">Target ADR</th>
                    <th className="px-3 py-2">Payroll</th>
                    <th className="px-3 py-2">Diubah</th>
                    {isAdmin && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.property_code} className="border-b border-ink/5">
                      <td className="px-4 py-2.5 font-medium text-ink/80">
                        {r.property_name}
                        <div className="text-ink/30 font-normal">{r.property_code}</div>
                      </td>
                      <td className="px-3 py-2.5">{r.total_rooms}</td>
                      <td className="px-3 py-2.5">
                        {Math.round(r.investor_share_pct * 100)}/{Math.round(r.mkh_share_pct * 100)}
                      </td>
                      <td className="px-3 py-2.5">{fmtCurrencyFull(r.guarantee_per_room)}</td>
                      <td className="px-3 py-2.5">{fmtCurrencyFull(r.target_net_adr)}</td>
                      <td className="px-3 py-2.5">
                        {r.payroll_employee_count}× {fmtCurrencyFull(r.payroll_per_employee)}
                      </td>
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
          title={editing.id ? `Ubah — ${editing.property_name}` : "Tambah Properti"}
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              <Btn onClick={() => setEditing(null)}>Batal</Btn>
              <Btn variant="primary" disabled={busy || !editing.property_code} onClick={save}>
                Simpan
              </Btn>
            </>
          }
        >
          <Field label="Kode Properti (mis. loonars-1)">
            <input
              className={inputCls}
              value={editing.property_code ?? ""}
              disabled={!!editing.id}
              onChange={(e) => setEditing({ ...editing, property_code: e.target.value })}
            />
          </Field>
          <Field label="Nama Properti">
            <input className={inputCls} value={editing.property_name ?? ""} onChange={(e) => setEditing({ ...editing, property_name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-x-4">
            {NUMERIC_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <input
                  className={inputCls}
                  type="number"
                  step="any"
                  value={(editing[f.key] as number | undefined) ?? ""}
                  onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
          <Field label="Catatan">
            <input className={inputCls} value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </Field>
        </Modal>
      )}
    </FinanceShell>
  );
}
