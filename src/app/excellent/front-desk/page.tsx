"use client";

import { useEffect, useState } from "react";
import { ExcellentShell } from "../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { ElRoom, ElRoomStatus, ElSummary } from "@/lib/types";

const EL_ROOM_STATUS_LABEL: Record<ElRoomStatus, string> = {
  available: "Siap",
  occupied: "Terisi",
  dirty: "Kotor",
  maintenance: "Maintenance",
};

const STATUS_CLS: Record<ElRoomStatus, string> = {
  available: "bg-sage-500/15 text-sage-600 border-sage-500/30",
  occupied: "bg-azure-500/15 text-azure-600 border-azure-500/30",
  dirty: "bg-gold-500/15 text-gold-600 border-gold-500/30",
  maintenance: "bg-ruby-500/15 text-ruby-600 border-ruby-500/30",
};

export default function ElStatusKamarPage() {
  const toast = useToast();
  const [rooms, setRooms] = useState<ElRoom[] | null>(null);
  const [summary, setSummary] = useState<ElSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    Promise.all([api.get<ElRoom[]>("/el/rooms"), api.get<ElSummary>("/el/summary")])
      .then(([r, s]) => {
        setRooms(r);
        setSummary(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }
  useEffect(load, []);

  async function ubahStatus(room: ElRoom, status: ElRoomStatus) {
    try {
      await api.patch("/el/rooms/status", { id: room.id, status });
      toast("✓", "Status diubah", `Kamar ${room.nomor}: ${EL_ROOM_STATUS_LABEL[status]}`, "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    }
  }

  const aktif = (rooms ?? []).filter((r) => r.active);
  const perTipe = new Map<string, ElRoom[]>();
  for (const r of aktif) {
    const t = r.el_room_types?.nama ?? "Lainnya";
    perTipe.set(t, [...(perTipe.get(t) ?? []), r]);
  }

  return (
    <ExcellentShell pageTitle="Status Kamar" pageSub="Loonars Excellent Living">
      {error && <div className="mb-4 text-[12px] text-ruby-500">{error}</div>}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatCard label="Kamar Siap" value={`${summary.available}/${summary.total_kamar}`} accent="sage" />
          <StatCard label="Terisi" value={String(summary.occupied)} accent="azure" />
          <StatCard label="Check-in Hari Ini" value={String(summary.checkin_hari_ini)} accent="gold" />
          <StatCard label="Check-out Hari Ini" value={String(summary.checkout_hari_ini)} accent="ruby" />
        </div>
      )}
      {!rooms ? (
        <Loading />
      ) : aktif.length === 0 ? (
        <Empty label="Belum ada kamar — admin bisa menambahkannya di Atur Kamar EL" />
      ) : (
        [...perTipe.entries()].map(([tipe, list]) => (
          <Card key={tipe} className="mb-5">
            <CardHeader title={tipe} subtitle={`${list.length} kamar`} />
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {list.map((r) => (
                <div key={r.id} className={`border rounded-xl p-3 ${STATUS_CLS[r.status]}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-[14px] text-ink">{r.nomor}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide">{EL_ROOM_STATUS_LABEL[r.status]}</div>
                  </div>
                  <div className="text-[11px] text-ink/50 mt-1 truncate min-h-[16px]">
                    {r.booking_hari_ini ? `${r.booking_hari_ini.guest_nama} · s/d ${r.booking_hari_ini.tgl_checkout}` : r.catatan ?? ""}
                  </div>
                  {r.status !== "occupied" && (
                    <select
                      className="mt-2 w-full text-[11px] bg-base-900 border border-ink/10 rounded px-2 py-1 text-ink/70"
                      value={r.status}
                      onChange={(e) => ubahStatus(r, e.target.value as ElRoomStatus)}
                      aria-label={`Ubah status kamar ${r.nomor}`}
                    >
                      <option value="available">Siap</option>
                      <option value="dirty">Kotor</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </ExcellentShell>
  );
}
