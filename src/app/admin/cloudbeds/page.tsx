"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { CloudbedsMapping, CloudbedsLogRow, Unit } from "@/lib/types";

export default function AdminCloudbedsPage() {
  const toast = useToast();
  const [mapping, setMapping] = useState<CloudbedsMapping[]>([]);
  const [log, setLog] = useState<CloudbedsLogRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ room_id: "", room_name: "", unit_id: "" });

  async function load() {
    setLoading(true);
    const [m, l, u] = await Promise.all([
      api.get<CloudbedsMapping[]>("/admin/cloudbeds/mapping"),
      api.get<CloudbedsLogRow[]>("/admin/cloudbeds/log"),
      api.get<Unit[]>("/units"),
    ]);
    setMapping(m || []);
    setLog(l || []);
    setUnits(u || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createMapping() {
    if (!form.room_id.trim() || !form.unit_id) {
      toast("⚠", "Lengkapi form", "Room ID dan unit wajib diisi.", "ruby");
      return;
    }
    try {
      await api.post("/admin/cloudbeds/mapping", {
        cloudbeds_room_id: form.room_id.trim(),
        cloudbeds_room_name: form.room_name.trim() || null,
        unit_id: form.unit_id,
      });
      setOpen(false);
      setForm({ room_id: "", room_name: "", unit_id: "" });
      toast("✓", "Tersimpan", "Pemetaan room berhasil disimpan.", "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function deleteMapping(id: string) {
    await api.delete(`/admin/cloudbeds/mapping?id=${id}`);
    load();
  }

  return (
    <AdminShell pageTitle="Cloudbeds" pageSub="Pemetaan room & log event">
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-ink/50 leading-relaxed mb-3.5">
        Webhook Cloudbeds: arahkan ke <code className="text-gold-400">https://living.haluoleo.id/api/webhooks/cloudbeds</code> dengan header{" "}
        <code className="text-gold-400">x-cloudbeds-secret</code> sesuai nilai <code className="text-gold-400">CLOUDBEDS_WEBHOOK_SECRET</code> di Vercel env variable project ini. Ditangani langsung di sini — bukan lagi lewat Supabase.
      </div>

      <Card className="mb-3.5">
        <CardHeader
          title="Pemetaan Room → Unit"
          action={
            <button onClick={() => setOpen(true)} className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0">
              + Petakan Room
            </button>
          }
        />
        {loading ? (
          <Loading />
        ) : mapping.length === 0 ? (
          <Loading label="Belum ada pemetaan" />
        ) : (
          mapping.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink/80">{m.cloudbeds_room_id}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">{m.cloudbeds_room_name || "—"}</div>
              </div>
              <div className="text-xs text-gold-500 shrink-0">{m.units ? `Unit ${m.units.nomor}` : "—"}</div>
              <button onClick={() => deleteMapping(m.id)} className="text-[10.5px] text-ruby-400 shrink-0">
                Hapus
              </button>
            </div>
          ))
        )}
      </Card>

      <Card>
        <CardHeader title="Log Event Cloudbeds Terbaru" />
        {log.length === 0 ? (
          <Loading label="Belum ada event" />
        ) : (
          log.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink/80">{l.event_type}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">
                  {l.reservation_id || "—"} · {fmtDate(l.created_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <Badge tone={l.matched ? "ok" : "danger"}>{l.matched ? "Matched" : "Tidak matched"}</Badge>
            </div>
          ))
        )}
      </Card>

      <Modal open={open} title="Petakan Room Cloudbeds" onClose={() => setOpen(false)} footer={<><Btn onClick={() => setOpen(false)}>Batal</Btn><Btn variant="primary" onClick={createMapping}>Simpan</Btn></>}>
        <Field label="Cloudbeds Room ID"><input className={inputCls} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })} placeholder="ID room dari Cloudbeds" /></Field>
        <Field label="Nama Room di Cloudbeds (opsional)"><input className={inputCls} value={form.room_name} onChange={(e) => setForm({ ...form, room_name: e.target.value })} /></Field>
        <Field label="Unit Villa">
          <select className={inputCls} value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
            <option value="">Pilih unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>Unit {u.nomor} (Blok {u.blok})</option>
            ))}
          </select>
        </Field>
      </Modal>
    </AdminShell>
  );
}
