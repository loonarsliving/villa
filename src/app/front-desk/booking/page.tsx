"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "../../admin/_shell";
import { FrontDeskShell } from "../_shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { fmtDate, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import type { Booking, Unit } from "@/lib/types";

const RANGE_OPTIONS = [7, 14, 21] as const;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function dateRange(start: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

const toneClass: Record<string, string> = {
  checkin: "bg-sage-500/25 border-sage-500/50 text-sage-700",
  terjadwal: "bg-gold-500/20 border-gold-500/40 text-gold-700",
  checkout: "bg-ink/[0.06] border-ink/15 text-ink/40",
};

/**
 * Booking calendar (Front Desk + Admin, read-only for now) -- unit rows,
 * date columns, bookings rendered as bars including Cloudbeds/OTA ones
 * (already synced into `bookings` in realtime via the Cloudbeds webhook,
 * so nothing extra needed to surface them here). Replaces the old flat
 * "50 latest bookings" list, which had no date-range/occupancy view.
 * Bars use percentage-of-container absolute positioning rather than CSS
 * Grid overlay, since grid auto-placement can't reliably stack a
 * variable-span bar on top of fixed per-day background cells in the same row.
 */
export default function BookingCalendarPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [units, setUnits] = useState<Unit[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState<number>(14);
  const [start, setStart] = useState(todayISO());

  const days = useMemo(() => dateRange(start, rangeDays), [start, rangeDays]);
  const end = days[days.length - 1];

  function load() {
    setLoading(true);
    Promise.all([
      api.get<Unit[]>("/units"),
      api.get<Booking[]>(`/bookings?date_from=${start}&date_to=${addDays(end, 1)}`),
    ])
      .then(([u, b]) => {
        setUnits(u || []);
        setBookings((b || []).filter((x) => x.status !== "batal"));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, start, rangeDays]);

  const Shell = user?.role === "admin" ? AdminShell : FrontDeskShell;

  if (!user) {
    return (
      <Shell pageTitle="Kalender Booking">
        <Loading />
      </Shell>
    );
  }

  const bloks = ["A", "B", "C"] as const;

  function dayIndex(dateIso: string): number {
    const diff = Math.round((new Date(`${dateIso}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000);
    return Math.max(0, Math.min(days.length, diff));
  }

  return (
    <Shell pageTitle="Kalender Booking" pageSub="Semua unit · termasuk booking OTA (Cloudbeds) realtime">
      <Card>
        <CardHeader
          title="Kalender"
          subtitle={`${fmtDate(start, { day: "2-digit", month: "short" })} – ${fmtDate(end, { day: "2-digit", month: "short", year: "numeric" })}`}
          action={
            <div className="flex items-center gap-1.5">
              <button onClick={() => setStart(addDays(start, -rangeDays))} className="w-7 h-7 rounded border border-ink/10 text-ink/50 shrink-0">
                ‹
              </button>
              <button onClick={() => setStart(todayISO())} className="text-[10px] font-semibold px-2.5 py-1.5 rounded border border-ink/10 text-ink/50 shrink-0">
                Hari Ini
              </button>
              <button onClick={() => setStart(addDays(start, rangeDays))} className="w-7 h-7 rounded border border-ink/10 text-ink/50 shrink-0">
                ›
              </button>
              <select
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value))}
                className="ml-1 bg-base-800 border border-ink/10 rounded text-[10.5px] px-2 py-1.5 text-ink/60"
              >
                {RANGE_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} hari
                  </option>
                ))}
              </select>
            </div>
          }
        />

        <div className="flex gap-3 px-4 sm:px-5 py-2 border-b border-ink/[0.05] text-[9.5px] text-ink/40">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-sage-500/40 border border-sage-500/60 inline-block" /> Check-In
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-gold-500/30 border border-gold-500/50 inline-block" /> Terjadwal
          </span>
          <span className="flex items-center gap-1">☁ Sumber Cloudbeds (OTA)</span>
        </div>

        {loading ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <div className="flex sticky top-0 z-20 bg-base-900">
              <div className="w-[84px] shrink-0 px-2 py-2 text-[9px] text-ink/30 sticky left-0 bg-base-900 z-30">Unit</div>
              <div className="flex-1 flex">
                {days.map((d) => (
                  <div
                    key={d}
                    style={{ minWidth: 44 }}
                    className={`flex-1 text-center py-2 text-[9px] border-l border-ink/[0.05] ${
                      d === todayISO() ? "bg-gold-500/10 text-gold-500 font-semibold" : "text-ink/40"
                    }`}
                  >
                    {fmtDate(d, { day: "2-digit", month: "short" })}
                  </div>
                ))}
              </div>
            </div>

            {bloks.map((blok) => {
              const blokUnits = units.filter((u) => u.blok === blok);
              if (blokUnits.length === 0) return null;
              return (
                <div key={blok}>
                  <div className="px-2 py-1.5 bg-gold-500/5 text-[9px] font-semibold text-gold-500 tracking-wide">Blok {blok}</div>
                  {blokUnits.map((u) => {
                    const unitBookings = bookings.filter((b) => b.unit_id === u.id);
                    return (
                      <div key={u.id} className="flex border-t border-ink/[0.04]">
                        <div className="w-[84px] shrink-0 px-2 py-2 text-[10.5px] text-ink/70 font-medium sticky left-0 bg-base-900 z-10">{u.nomor}</div>
                        <div className="relative flex-1" style={{ minHeight: 40 }}>
                          <div className="absolute inset-0 flex">
                            {days.map((d) => (
                              <div
                                key={d}
                                style={{ minWidth: 44 }}
                                className={`flex-1 border-l border-ink/[0.04] ${d === todayISO() ? "bg-gold-500/5" : ""}`}
                              />
                            ))}
                          </div>
                          <div className="absolute inset-0 py-1.5">
                            {unitBookings.map((b) => {
                              const startIdx = dayIndex(b.tgl_checkin);
                              const endIdx = b.tgl_checkout ? dayIndex(b.tgl_checkout) : days.length;
                              const span = Math.max(1, endIdx - startIdx);
                              const leftPct = (startIdx / days.length) * 100;
                              const widthPct = (span / days.length) * 100;
                              return (
                                <button
                                  key={b.id}
                                  onClick={() =>
                                    toast(
                                      b.sumber === "cloudbeds" ? "☁" : "◎",
                                      b.guest_nama,
                                      `Unit ${b.unit_nomor} · ${fmtDate(b.tgl_checkin)} – ${b.tgl_checkout ? fmtDate(b.tgl_checkout) : "belum ada tanggal keluar"} · ${
                                        b.sumber === "cloudbeds" ? "Cloudbeds" : b.sumber
                                      } · ${b.status}`,
                                      b.sumber === "cloudbeds" ? "gold" : "sage",
                                    )
                                  }
                                  style={{ position: "absolute", left: `${leftPct}%`, width: `calc(${widthPct}% - 4px)`, marginLeft: 2, top: 0, bottom: 0 }}
                                  className={`rounded px-2 text-left text-[9.5px] truncate border ${toneClass[b.status] || toneClass.terjadwal}`}
                                  title={`${b.guest_nama} — Unit ${b.unit_nomor}`}
                                >
                                  {b.sumber === "cloudbeds" ? "☁ " : ""}
                                  {b.guest_nama}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </Shell>
  );
}
