"use client";

import { useEffect } from "react";
import { FrontDeskShell } from "../_shell";
import { api } from "@/lib/api";
import { useNotifPoll } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";

export default function FrontDeskNotifPage() {
  const { notifications, refresh } = useNotifPoll("role=all", "is_read_staff");

  useEffect(() => {
    api.patch("/notifications/read", { role: "receptionist" }).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FrontDeskShell pageTitle="Notifikasi" pageSub="Real-time">
      <Card>
        <CardHeader title="Notifikasi Real-Time" />
        {notifications.length === 0 ? (
          <Loading label="Tidak ada notifikasi" />
        ) : (
          notifications.map((n) => (
            <div key={n.id} className="flex gap-2.5 px-4 sm:px-5 py-3 border-b border-white/[0.05] last:border-0 items-start">
              <div className="w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0 mt-1.5" />
              <div>
                <div className="text-[11.5px] text-white/50 leading-relaxed">
                  <b className="text-white">{n.judul}</b> — {n.pesan}
                </div>
                <div className="text-[9.5px] text-white/30 mt-0.5">{fmtDate(n.created_at, { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
            </div>
          ))
        )}
      </Card>
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-white/50 leading-relaxed mt-3.5">
        Booking dari OTA (Traveloka, Airbnb, dll) otomatis masuk lewat Cloudbeds. Check-in & checkout tetap diproses manual oleh resepsionis di sini. Setiap aksi otomatis terkirim ke dashboard investor masing-masing unit.
      </div>
    </FrontDeskShell>
  );
}
