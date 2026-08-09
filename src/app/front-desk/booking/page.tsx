"use client";

import { useEffect, useState } from "react";
import { FrontDeskShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import { Badge } from "@/components/Card";
import type { Booking } from "@/lib/types";

const statusTone: Record<string, "ok" | "pending" | "danger"> = {
  terjadwal: "pending",
  checkin: "ok",
  checkout: "danger",
};
const statusText: Record<string, string> = { terjadwal: "Terjadwal", checkin: "Check-In", checkout: "Checkout" };

export default function BookingPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Booking[]>("/bookings").then((b) => {
      setBookings(b || []);
      setLoading(false);
    });
  }, []);

  return (
    <FrontDeskShell pageTitle="Daftar Booking" pageSub="Semua unit">
      <Card>
        <CardHeader title="Semua Booking" />
        {loading ? (
          <Loading />
        ) : bookings.length === 0 ? (
          <Loading label="Belum ada booking" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px] min-w-[560px]">
              <thead>
                <tr className="bg-base-800">
                  {["Tamu", "Unit", "Check-In", "Tipe", "Sumber", "Status"].map((h) => (
                    <th key={h} className="text-left px-3.5 py-2 text-[8.5px] font-semibold tracking-wide uppercase text-white/30 border-b border-white/[0.08]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-base-800/50">
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] font-medium text-white/80">{b.guest_nama}</td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] text-gold-500">{b.unit_nomor}</td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] text-white/70">{fmtDate(b.tgl_checkin)}</td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] text-white/30 text-[9.5px]">{b.tipe}</td>
                    <td className={`px-3.5 py-2.5 border-b border-white/[0.05] text-[9.5px] ${b.sumber === "cloudbeds" ? "text-gold-500" : "text-white/30"}`}>
                      {b.sumber === "cloudbeds" ? "☁ Cloudbeds" : b.sumber}
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05]">
                      <Badge tone={statusTone[b.status] || "pending"}>{statusText[b.status] || b.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </FrontDeskShell>
  );
}
