"use client";

import { useState, type ReactNode } from "react";
import { todayISO } from "@/lib/format";
import { addDaysISO } from "@/lib/stayDates";

/**
 * Filter periode yang dipakai bersama oleh halaman-halaman Finance
 * (Ringkasan, Laba Rugi, Pendapatan, Transaksi). Tiap halaman punya
 * pilihannya sendiri, default "Bulan ini".
 */

export type Preset = "today" | "yesterday" | "week" | "month" | "last_month" | "custom";

export function presetRange(preset: Preset): { from: string; to: string } {
  const today = todayISO();
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const y = addDaysISO(today, -1);
    return { from: y, to: y };
  }
  if (preset === "week") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=Sun
    const mondayOffset = dow === 0 ? -6 : -(dow - 1);
    return { from: addDaysISO(today, mondayOffset), to: today };
  }
  if (preset === "last_month") {
    const [y, m] = today.slice(0, 7).split("-").map(Number);
    const prevTotal = y * 12 + (m - 1) - 1;
    const py = Math.floor(prevTotal / 12);
    const pm = (prevTotal % 12) + 1;
    const from = `${py}-${String(pm).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10);
    return { from, to: lastDay };
  }
  // month (default) & custom fallback
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export const PRESET_LABELS: Record<Preset, string> = {
  today: "Hari ini",
  yesterday: "Kemarin",
  week: "Minggu ini",
  month: "Bulan ini",
  last_month: "Bulan lalu",
  custom: "Custom",
};

export function usePeriode() {
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const range = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset);
  return { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, range };
}

export type Periode = ReturnType<typeof usePeriode>;

export function PeriodeBar({ p, children }: { p: Periode; children?: ReactNode }) {
  const { preset, setPreset, setCustomFrom, setCustomTo, range } = p;
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {(Object.keys(PRESET_LABELS) as Preset[])
        .filter((k) => k !== "custom")
        .map((k) => (
          <button
            key={k}
            onClick={() => setPreset(k)}
            className={`shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition ${
              preset === k ? "bg-ink text-base-900 border-ink" : "border-ink/15 text-ink/60 hover:border-ink/30"
            }`}
          >
            {PRESET_LABELS[k]}
          </button>
        ))}
      <input
        type="date"
        className="text-[11px] px-2 py-1.5 rounded-full border border-ink/15 bg-transparent"
        // Tampilkan rentang yang SEDANG dipakai, bukan sisa isian custom:
        // dulu "Bulan ini" tetap tertulis "20 Oct s/d 20 Oct", sehingga
        // total sebulan terbaca seperti pemasukan satu hari.
        value={range.from}
        onChange={(e) => {
          setCustomFrom(e.target.value);
          setCustomTo(range.to);
          setPreset("custom");
        }}
      />
      <span className="text-ink/30 text-[11px] self-center">s/d</span>
      <input
        type="date"
        className="text-[11px] px-2 py-1.5 rounded-full border border-ink/15 bg-transparent"
        value={range.to}
        onChange={(e) => {
          setCustomFrom(range.from);
          setCustomTo(e.target.value);
          setPreset("custom");
        }}
      />
      {children}
    </div>
  );
}
