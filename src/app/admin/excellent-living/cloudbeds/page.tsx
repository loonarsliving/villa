"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../../_shell";
import { api, localApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { ElRoom } from "@/lib/types";

interface Mapping { id: string; cloudbeds_room_id: string; cloudbeds_room_name: string | null; room_id: string; el_rooms: { nomor: string } | null }
interface LogRow { id: string; reservation_id: string | null; event_type: string | null; matched: boolean; error: string | null; created_at: string }
interface CbRoom { roomID: string; roomName: string; roomTypeName?: string }

/** Koneksi Cloudbeds kedua (akun Excellent Living, env CLOUDBEDS2_*). */
export default function ElCloudbedsPage() {
  const toast = useToast();
  const [mappings, setMappings] = useState<Mapping[] | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [rooms, setRooms] = useState<ElRoom[]>([]);
  const [cbRooms, setCbRooms] = useState<CbRoom[] | null>(null);
  const [cbError, setCbError] = useState<string | null>(null);
  const [form, setForm] = useState<{ cloudbeds_room_id: string; cloudbeds_room_name: string; room_id: string } | null>(null);

  function load() {
    api.get<Mapping[]>("/el/admin/cloudbeds/mapping").then(setMappings).catch(() => setMappings([]));
    api.get<LogRow[]>("/el/admin/cloudbeds/log").then(setLog).catch(() => setLog([]));
  }
  useEffect(() => {
    load();
    api.get<ElRoom[]>("/el/rooms").then((r) => setRooms(r.filter((x) => x.active))).catch(() => setRooms([]));
    localApi<{ rooms: CbRoom[] }>("/api/admin/cloudbeds-el/rooms")
      .then((r) => setCbRooms(r.rooms))
      .catch((e) => setCbError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function simpan() {
    if (!form?.cloudbeds_room_id || !form.room_id) {
      toast("⚠", "Lengkapi form", "Room Cloudbeds dan kamar wajib diisi.", "ruby");
      return;
    }
    try {
      await api.post("/el/admin/cloudbeds/mapping", form);
      toast("✓", "Tersimpan", "Pemetaan room disimpan.", "sage");
      setForm(null);
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    }
  }

  async function hapus(id: string) {
    if (!confirm("Hapus pemetaan ini?")) return;
    try {
      await api.delete(`/el/admin/cloudbeds/mapping?id=${encodeURIComponent(id)}`);
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    }
  }

  return (
    <AdminShell pageTitle="Cloudbeds Excellent Living" pageSub="Akun Cloudbeds kedua">
      <div className={`mb-5 rounded-xl px-4 py-3 text-[12px] ${cbRooms ? "bg-sage-500/10 text-sage-600" : "bg-gold-500/10 text-gold-600"}`}>
        {cbRooms
          ? `Terhubung ke Cloudbeds API — ${cbRooms.length} room tersedia`
          : cbError
            ? `Belum terhubung: ${cbError}. Isi env var CLOUDBEDS2_API_KEY (dan CLOUDBEDS2_PROPERTY_ID bila perlu) di Vercel.`
            : "Memeriksa koneksi Cloudbeds..."}
        <div className="text-[11px] opacity-80 mt-1">
          Webhook: <code>/api/webhooks/cloudbeds-el</code> dengan header <code>x-cloudbeds-secret</code> = CLOUDBEDS2_WEBHOOK_SECRET
        </div>
      </div>

      <Card className="mb-5">
        <CardHeader
          title="Pemetaan Room"
          subtitle="Room Cloudbeds → kamar Excellent Living"
          action={<Btn variant="primary" onClick={() => setForm({ cloudbeds_room_id: "", cloudbeds_room_name: "", room_id: "" })}>+ Petakan Room</Btn>}
        />
        {!mappings ? (
          <Loading />
        ) : mappings.length === 0 ? (
          <Empty label="Belum ada pemetaan" />
        ) : (
          <div className="divide-y divide-ink/[0.05]">
            {mappings.map((mp) => (
              <div key={mp.id} className="px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3 text-[12px]">
                <span className="text-ink/70">{mp.cloudbeds_room_name ?? mp.cloudbeds_room_id} <span className="text-ink/30">({mp.cloudbeds_room_id})</span></span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-ink">→ {mp.el_rooms?.nomor ?? "?"}</span>
                  <Btn onClick={() => hapus(mp.id)}>Hapus</Btn>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Log Webhook" subtitle="100 kejadian terakhir" />
        {log.length === 0 ? (
          <Empty label="Belum ada kejadian" />
        ) : (
          <div className="divide-y divide-ink/[0.05]">
            {log.map((l) => (
              <div key={l.id} className="px-4 sm:px-5 py-2.5 text-[11.5px] flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-ink/40">{fmtDateTime(l.created_at)}</span>
                <span className="text-ink/70">{l.event_type}</span>
                <span className="text-ink/50">{l.reservation_id ?? "-"}</span>
                {l.matched ? <Badge tone="ok">cocok</Badge> : <Badge tone="danger">{l.error ?? "tidak cocok"}</Badge>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!form}
        title="Petakan Room Cloudbeds"
        onClose={() => setForm(null)}
        footer={<><Btn onClick={() => setForm(null)}>Batal</Btn><Btn variant="primary" onClick={simpan}>Simpan</Btn></>}
      >
        {form && (
          <>
            {cbRooms ? (
              <Field label="Room Cloudbeds">
                <select
                  className={inputCls}
                  value={form.cloudbeds_room_id}
                  onChange={(e) => {
                    const r = cbRooms.find((x) => x.roomID === e.target.value);
                    setForm({ ...form, cloudbeds_room_id: e.target.value, cloudbeds_room_name: r?.roomName ?? "" });
                  }}
                >
                  <option value="">Pilih room</option>
                  {cbRooms.map((r) => <option key={r.roomID} value={r.roomID}>{r.roomName}{r.roomTypeName ? ` — ${r.roomTypeName}` : ""}</option>)}
                </select>
              </Field>
            ) : (
              <>
                <Field label="Cloudbeds Room ID"><input className={inputCls} value={form.cloudbeds_room_id} onChange={(e) => setForm({ ...form, cloudbeds_room_id: e.target.value })} /></Field>
                <Field label="Nama Room (opsional)"><input className={inputCls} value={form.cloudbeds_room_name} onChange={(e) => setForm({ ...form, cloudbeds_room_name: e.target.value })} /></Field>
              </>
            )}
            <Field label="Kamar Excellent Living">
              <select className={inputCls} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
                <option value="">Pilih kamar</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.nomor} — {r.el_room_types?.nama ?? ""}</option>)}
              </select>
            </Field>
          </>
        )}
      </Modal>
    </AdminShell>
  );
}
