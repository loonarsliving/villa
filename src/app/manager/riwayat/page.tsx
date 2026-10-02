"use client";

import { useEffect, useState } from "react";
import { ManagerShell } from "../_shell";
import { LABEL_CHECKLIST } from "../_checklist";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import type { RiwayatCekKamar } from "@/lib/types";

const LABEL_AKSI: Record<RiwayatCekKamar["cloudbeds_aksi"], { teks: string; cls: string }> = {
  ditutup: { teks: "Ditutup di Cloudbeds", cls: "text-ruby-400" },
  diperpanjang: { teks: "Maintenance diperpanjang", cls: "text-ruby-400" },
  dibuka: { teks: "Dibuka lagi di Cloudbeds", cls: "text-sage-500" },
  tidak_perlu: { teks: "Siap, tetap dijual", cls: "text-sage-500" },
  gagal: { teks: "GAGAL di Cloudbeds", cls: "text-gold-500" },
};

export default function RiwayatCekPage() {
  const [rows, setRows] = useState<RiwayatCekKamar[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RiwayatCekKamar[]>("/manager/riwayat")
      .then((r) => setRows(r || []))
      .catch((e) => setGalat(e instanceof Error ? e.message : "Gagal memuat riwayat"));
  }, []);

  return (
    <ManagerShell pageTitle="Riwayat Cek" pageSub="50 pengecekan terakhir">
      <Card>
        <CardHeader title="Riwayat Cek Kamar" />
        {galat ? (
          <Empty label={galat} />
        ) : !rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty label="Belum ada pengecekan" />
        ) : (
          rows.map((r) => {
            const aksi = LABEL_AKSI[r.cloudbeds_aksi] ?? { teks: r.cloudbeds_aksi, cls: "text-ink/50" };
            const bermasalah = Object.entries(r.checklist ?? {})
              .filter(([, ok]) => !ok)
              .map(([k]) => LABEL_CHECKLIST[k] ?? k);
            return (
              <div key={r.id} className="px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12.5px] text-ink">
                    Unit {r.unit_nomor ?? "—"} · <span className={aksi.cls}>{aksi.teks}</span>
                  </div>
                  <div className="text-[10.5px] text-ink/30 shrink-0">{fmtDateTime(r.created_at)}</div>
                </div>
                <div className="text-[11px] text-ink/40 mt-1">
                  {r.dicek_oleh_nama ?? "—"}
                  {r.tutup_mulai && r.tutup_sampai && ` · tutup ${fmtDate(r.tutup_mulai)} s/d ${fmtDate(r.tutup_sampai)}`}
                  {bermasalah.length > 0 && ` · bermasalah: ${bermasalah.join(", ")}`}
                </div>
                {r.catatan && <div className="text-[11px] text-ink/60 mt-1">{r.catatan}</div>}
                {r.cloudbeds_pesan && <div className="text-[10.5px] text-ink/30 mt-1">{r.cloudbeds_pesan}</div>}
              </div>
            );
          })
        )}
      </Card>
    </ManagerShell>
  );
}
