"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import type { WaLogRow } from "@/lib/types";

const statusTone: Record<string, "ok" | "pending" | "danger"> = {
  sent: "ok",
  queued_trigger: "pending",
  skipped_no_phone: "pending",
  skipped_not_configured: "pending",
  failed: "danger",
  error: "danger",
};

export default function AdminWaLogPage() {
  const [rows, setRows] = useState<WaLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<WaLogRow[]>("/admin/wa/log")
      .then((r) => setRows(r || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell pageTitle="Log WhatsApp" pageSub="50 pesan terakhir">
      <Card>
        <CardHeader title="Riwayat Pengiriman WA" />
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Loading label="Belum ada log" />
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-white/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white/80 truncate">{r.message || "—"}</div>
                <div className="text-[10px] text-white/30 mt-0.5">
                  {r.phone || "tanpa nomor"} · {r.template_type || "—"} · {fmtDate(r.created_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <Badge tone={statusTone[r.status || ""] || "pending"}>{r.status}</Badge>
            </div>
          ))
        )}
      </Card>
    </AdminShell>
  );
}
