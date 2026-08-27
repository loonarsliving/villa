"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { CloudbedsMapping, CloudbedsLogRow, Unit } from "@/lib/types";

interface LiveCloudbedsRoom {
  roomID: string;
  roomName: string;
  roomTypeName?: string;
}

export default function AdminCloudbedsPage() {
  const toast = useToast();
  const [mapping, setMapping] = useState<CloudbedsMapping[]>([]);
  const [log, setLog] = useState<CloudbedsLogRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ room_id: "", room_name: "", unit_id: "" });
  const [liveRooms, setLiveRooms] = useState<LiveCloudbedsRoom[]>([]);
  const [liveRoomsError, setLiveRoomsError] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);

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

  async function loadLiveRooms() {
    try {
      const res = await fetch("/api/admin/cloudbeds/rooms");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setLiveRoomsError((body && body.error) || `HTTP ${res.status}`);
        setLiveRooms([]);
        return;
      }
      setLiveRooms(body?.rooms || []);
      setLiveRoomsError(null);
    } catch (e) {
      setLiveRoomsError(e instanceof Error ? e.message : "Gagal memuat daftar room Cloudbeds");
      setLiveRooms([]);
    }
  }

  useEffect(() => {
    load();
    loadLiveRooms();
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

      <div className={`rounded-r border-l-2 p-3.5 text-[11px] leading-relaxed mb-3.5 ${liveRoomsError ? "bg-ruby-500/10 border-ruby-500 text-ink/50" : "bg-sage-500/10 border-sage-500 text-ink/50"}`}>
        {liveRoomsError ? (
          <>
            Daftar room live Cloudbeds belum tersedia ({liveRoomsError}). Set <code className="text-gold-400">CLOUDBEDS_API_KEY</code> (dan{" "}
            <code className="text-gold-400">CLOUDBEDS_PROPERTY_ID</code> jika perlu) di Vercel env variable — pemetaan manual di bawah tetap bisa dipakai sementara.
          </>
        ) : (
          <>Terhubung ke Cloudbeds API — {liveRooms.length} room tersedia untuk dipetakan langsung dari daftar live.</>
        )}
      </div>

      <Card className="mb-3.5">
        <CardHeader
          title="Pemetaan Room → Unit"
          action={
            <button
              onClick={() => {
                setManualEntry(liveRoomsError !== null || liveRooms.length === 0);
                setOpen(true);
              }}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0"
            >
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
        {!liveRoomsError && liveRooms.length > 0 && !manualEntry ? (
          <>
            <Field label="Room Cloudbeds (live)">
              <select
                className={inputCls}
                value={form.room_id}
                onChange={(e) => {
                  const room = liveRooms.find((r) => r.roomID === e.target.value);
                  setForm({ ...form, room_id: e.target.value, room_name: room?.roomName || "" });
                }}
              >
                <option value="">Pilih room</option>
                {liveRooms.map((r) => (
                  <option key={r.roomID} value={r.roomID}>
                    {r.roomName} {r.roomTypeName ? `— ${r.roomTypeName}` : ""} ({r.roomID})
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" onClick={() => setManualEntry(true)} className="text-[10.5px] text-gold-500 mb-3">
              Input manual sebagai gantinya
            </button>
          </>
        ) : (
          <>
            <Field label="Cloudbeds Room ID"><input className={inputCls} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })} placeholder="ID room dari Cloudbeds" /></Field>
            <Field label="Nama Room di Cloudbeds (opsional)"><input className={inputCls} value={form.room_name} onChange={(e) => setForm({ ...form, room_name: e.target.value })} /></Field>
            {!liveRoomsError && liveRooms.length > 0 && (
              <button type="button" onClick={() => setManualEntry(false)} className="text-[10.5px] text-gold-500 mb-3">
                Pilih dari daftar live sebagai gantinya
              </button>
            )}
          </>
        )}
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
