"use client";

import { useEffect } from "react";
import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useNotifPoll } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";

export default function NotifikasiPage() {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const { notifications, refresh } = useNotifPoll(`unit_id=${unitId}&role=owner`, "is_read_owner");

  useEffect(() => {
    if (!unitId) return;
    api.patch("/notifications/read", { role: "owner" }).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  return (
    <InvestorShell pageTitle="Notifikasi" pageSub="Pembaruan unit Anda">
      <Card>
        <CardHeader title="Notifikasi Unit Anda" />
        {notifications.length === 0 ? (
          <Loading label="Tidak ada notifikasi" />
        ) : (
          notifications.map((n) => (
            <div key={n.id} className="flex gap-2.5 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 items-start">
              <div className="w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0 mt-1.5" />
              <div>
                <div className="text-[11.5px] text-ink/50 leading-relaxed">
                  <b className="text-ink">{n.judul}</b> — {n.pesan}
                </div>
                <div className="text-[9.5px] text-ink/30 mt-0.5">{fmtDate(n.created_at, { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
            </div>
          ))
        )}
      </Card>
    </InvestorShell>
  );
}
