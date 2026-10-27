"use client";

import { useEffect, useState } from "react";
import { ExcellentShell } from "../../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { Btn } from "@/components/Modal";
import type { ElHousekeepingTask } from "@/lib/types";

/** Kamar EL yang perlu dibersihkan (dibuat otomatis saat check-out / pindah kamar). */
export default function ElHousekeepingPage() {
  const toast = useToast();
  const [data, setData] = useState<{ pending: ElHousekeepingTask[]; selesai_hari_ini: ElHousekeepingTask[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api
      .get<{ pending: ElHousekeepingTask[]; selesai_hari_ini: ElHousekeepingTask[] }>("/el/housekeeping")
      .then(setData)
      .catch((e) => {
        setData({ pending: [], selesai_hari_ini: [] });
        toast("⚠", "Gagal memuat", e instanceof Error ? e.message : String(e), "ruby");
      });
  }
  useEffect(load, []);

  async function selesai(t: ElHousekeepingTask) {
    setBusyId(t.id);
    try {
      await api.patch("/el/housekeeping/done", { id: t.id });
      toast("✓", "Kamar siap", `Kamar ${t.room_nomor ?? ""} sudah dibersihkan`, "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ExcellentShell pageTitle="Housekeeping" pageSub="Loonars Excellent Living">
      <Card className="mb-5">
        <CardHeader title="Perlu Dibersihkan" subtitle={data ? `${data.pending.length} kamar` : undefined} />
        {!data ? (
          <Loading />
        ) : data.pending.length === 0 ? (
          <Empty label="Semua kamar sudah bersih" />
        ) : (
          <div className="divide-y divide-ink/[0.05]">
            {data.pending.map((t) => (
              <div key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-[14px] text-ink">Kamar {t.room_nomor ?? "—"}</div>
                  <div className="text-[11px] text-ink/45 truncate">
                    Sejak {fmtDateTime(t.created_at)}
                    {t.catatan ? ` · ${t.catatan}` : ""}
                  </div>
                </div>
                <Btn variant="primary" disabled={busyId === t.id} onClick={() => selesai(t)}>
                  {busyId === t.id ? "Menyimpan…" : "Sudah Bersih"}
                </Btn>
              </div>
            ))}
          </div>
        )}
      </Card>
      {data && data.selesai_hari_ini.length > 0 && (
        <Card>
          <CardHeader title="Selesai Hari Ini" subtitle={`${data.selesai_hari_ini.length} kamar`} />
          <div className="divide-y divide-ink/[0.05]">
            {data.selesai_hari_ini.map((t) => (
              <div key={t.id} className="px-4 py-2.5 text-[12px] text-ink/60 flex justify-between gap-3">
                <span>Kamar {t.room_nomor ?? "—"}</span>
                <span className="text-ink/40">{fmtDateTime(t.done_at)}{t.done_by ? ` · ${t.done_by}` : ""}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </ExcellentShell>
  );
}
