"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";

/**
 * Database tamu (permintaan owner 2026-09-12: "kt punya database tamu").
 *
 * Halaman ini sengaja TIDAK punya tombol "tambah tamu". Tamu masuk ke sini
 * dengan sendirinya lewat pemesanan -- dari web, dari walk-in, dan dari OTA
 * lewat sinkronisasi Cloudbeds. Daftar kontak yang diketik ulang manusia
 * akan langsung berbeda dari yang dipakai sistem untuk mengirim WhatsApp.
 *
 * Yang bisa diubah admin di sini hanya dua hal yang memang tidak bisa
 * diturunkan dari data pemesanan: status berhenti-langganan dan catatan.
 * Statistik menginap dihitung di view villa_guest_directory, jadi tidak
 * pernah basi.
 */

interface GuestRow {
  guest_id: string;
  nama: string | null;
  hp: string | null;
  email: string | null;
  jumlah_menginap: number;
  pertama_menginap: string | null;
  terakhir_menginap: string | null;
  total_belanja: number;
  sumber_pertama: string | null;
  wa_opt_out: boolean;
  email_opt_out: boolean;
  terakhir_dikirimi_promo: string | null;
  catatan: string | null;
}

interface Summary {
  total_tamu: number;
  punya_hp: number;
  punya_email: number;
  bisa_diwa: number;
  berhenti_langganan: number;
  tamu_berulang: number;
  per_sumber: Record<string, number>;
}

const SUMBER_LABEL: Record<string, string> = {
  website: "Web resmi",
  cloudbeds: "OTA / Cloudbeds",
  "walk-in": "Walk-in",
};

export default function GuestDatabasePage() {
  const [rows, setRows] = useState<GuestRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [edit, setEdit] = useState<GuestRow | null>(null);
  const [form, setForm] = useState({ wa_opt_out: false, email_opt_out: false, catatan: "" });
  const [saving, setSaving] = useState(false);

  async function load() {
    setErr(null);
    try {
      const [list, sum] = await Promise.all([
        api.get<GuestRow[]>("/guests/directory?limit=500"),
        api.get<Summary>("/guests/directory/summary"),
      ]);
      setRows(list);
      setSummary(sum);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat database tamu");
      setRows([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Disaring di browser, bukan lewat permintaan baru tiap ketukan: seluruh
  // daftarnya sudah ada di memori dan jumlahnya ratusan, bukan jutaan.
  const tampil = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return rows ?? [];
    return (rows ?? []).filter((r) =>
      [r.nama, r.hp, r.email].some((v) => String(v ?? "").toLowerCase().includes(key)),
    );
  }, [rows, q]);

  function bukaEdit(r: GuestRow) {
    setEdit(r);
    setForm({ wa_opt_out: r.wa_opt_out, email_opt_out: r.email_opt_out, catatan: r.catatan ?? "" });
  }

  async function simpan() {
    if (!edit) return;
    setSaving(true);
    setErr(null);
    try {
      await api.patch("/guests/marketing", {
        guest_id: edit.guest_id,
        wa_opt_out: form.wa_opt_out,
        email_opt_out: form.email_opt_out,
        catatan: form.catatan,
      });
      setEdit(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell pageTitle="Database Tamu" pageSub="Kontak tamu dari web, walk-in, dan OTA — terkumpul sendiri dari pemesanan">
      {err && <div className="mb-4 text-[12px] text-red-400">{err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kartu label="Total tamu" nilai={summary?.total_tamu} />
        <Kartu label="Punya nomor WA" nilai={summary?.punya_hp} />
        <Kartu label="Punya email" nilai={summary?.punya_email} />
        <Kartu label="Bisa dikirimi promo" nilai={summary?.bisa_diwa} sub="punya WA & belum berhenti" />
      </div>

      <Card className="mb-5">
        <CardHeader title="Asal tamu" />
        <CardBody>
          {!summary ? (
            <Loading />
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.per_sumber).map(([k, v]) => (
                <span key={k} className="text-[11.5px] text-ink/60 border border-ink/10 rounded px-2.5 py-1">
                  {SUMBER_LABEL[k] ?? k}: <strong className="text-ink">{v}</strong>
                </span>
              ))}
              <span className="text-[11.5px] text-ink/60 border border-ink/10 rounded px-2.5 py-1">
                Pernah menginap &gt;1x: <strong className="text-ink">{summary.tamu_berulang}</strong>
              </span>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Daftar tamu${rows ? ` (${tampil.length})` : ""}`} />
        <CardBody>
          <input
            className={`${inputCls} mb-4`}
            placeholder="Cari nama, nomor WA, atau email..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {!rows ? (
            <Loading />
          ) : tampil.length === 0 ? (
            <Empty label={q ? "Tidak ada tamu yang cocok" : "Belum ada tamu"} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-ink/30 text-[9.5px] uppercase tracking-[0.12em]">
                    <th className="text-left py-2">Nama</th>
                    <th className="text-left py-2">Kontak</th>
                    <th className="text-left py-2">Asal</th>
                    <th className="text-right py-2">Menginap</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-left py-2">Terakhir</th>
                    <th className="text-left py-2">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tampil.map((r) => (
                    <tr key={r.guest_id} className="border-t border-ink/5">
                      <td className="py-2.5 text-ink">{r.nama ?? "-"}</td>
                      <td className="py-2.5 text-ink/60">
                        <div>{r.hp ?? <span className="text-ink/25">tanpa nomor</span>}</div>
                        <div className="text-[11px] text-ink/40">{r.email ?? "tanpa email"}</div>
                      </td>
                      <td className="py-2.5 text-ink/50">{SUMBER_LABEL[r.sumber_pertama ?? ""] ?? r.sumber_pertama ?? "-"}</td>
                      <td className="py-2.5 text-right text-ink">{r.jumlah_menginap}</td>
                      <td className="py-2.5 text-right text-ink/70">{fmtCurrency(r.total_belanja)}</td>
                      <td className="py-2.5 text-ink/50">{r.terakhir_menginap ? fmtDate(r.terakhir_menginap) : "-"}</td>
                      <td className="py-2.5">
                        {r.wa_opt_out || r.email_opt_out ? (
                          <Badge tone="danger">Berhenti langganan</Badge>
                        ) : r.hp ? (
                          <Badge tone="ok">Bisa dihubungi</Badge>
                        ) : (
                          <Badge tone="pending">Tanpa nomor</Badge>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <button onClick={() => bukaEdit(r)} className="text-[11px] text-gold-500">
                          Ubah
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!edit}
        title={edit?.nama ?? "Tamu"}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Btn onClick={() => setEdit(null)}>Batal</Btn>
            <Btn variant="primary" onClick={() => void simpan()}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Btn>
          </>
        }
      >
        <Field label="Berhenti langganan">
          <label className="flex items-center gap-2 text-[12.5px] text-ink/70 mb-2">
            <input type="checkbox" checked={form.wa_opt_out} onChange={(e) => setForm({ ...form, wa_opt_out: e.target.checked })} />
            Jangan kirimi promo lewat WhatsApp
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-ink/70">
            <input type="checkbox" checked={form.email_opt_out} onChange={(e) => setForm({ ...form, email_opt_out: e.target.checked })} />
            Jangan kirimi promo lewat email
          </label>
        </Field>
        <Field label="Catatan internal">
          <input className={inputCls} value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} placeholder="mis. tamu rombongan kantor" />
        </Field>
        <p className="text-[11px] text-ink/35 leading-relaxed">
          Nama, nomor, dan email tidak diubah dari sini — semuanya ikut data pemesanan, supaya tidak ada dua versi nomor
          yang sama.
        </p>
      </Modal>
    </AdminShell>
  );
}

function Kartu({ label, nilai, sub }: { label: string; nilai?: number; sub?: string }) {
  return (
    <Card>
      <CardBody>
        <div className="text-[9.5px] uppercase tracking-[0.12em] text-ink/30 mb-1.5">{label}</div>
        <div className="text-2xl font-light text-ink">{nilai ?? "—"}</div>
        {sub && <div className="text-[10.5px] text-ink/30 mt-1">{sub}</div>}
      </CardBody>
    </Card>
  );
}
