"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { getToken } from "@/lib/api";
import { Loading, Card, CardHeader, Empty } from "@/components/Card";

/**
 * Phase 10 (revenue-engine program): occupancy forecast foundation.
 * Reads /api/admin/occupancy-forecast -- a deterministic day-of-week
 * seasonality average over real snapshot history (NOT AI/LLM; see that
 * route's comment for why forecasting with near-zero data would just be
 * fabricated noise). Every day without enough real history shows an
 * honest "belum cukup data" instead of a guessed number.
 */

interface ForecastDay {
  date: string;
  weekday: number;
  forecast_occupancy_pct: number | null;
  sample_count: number;
}

interface ForecastResponse {
  from: string;
  to: string;
  history_days_available: number;
  min_samples_required: number;
  forecast: ForecastDay[];
}

const WEEKDAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

export default function OccupancyForecastPage() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    setLoading(true);
    fetch("/api/admin/occupancy-forecast", { headers: token ? { "x-villa-token": token } : {} })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        return body as ForecastResponse;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell pageTitle="Perkiraan Okupansi" pageSub="Rata-rata pola hari-per-hari dari data riil — bukan AI, bukan tebakan">
      {loading && <Loading />}
      {!loading && error && (
        <Card>
          <Empty label={`Gagal memuat: ${error}`} />
        </Card>
      )}
      {!loading && !error && data && (
        <>
          {data.history_days_available < data.min_samples_required && (
            <Card className="mb-4">
              <div className="p-4 sm:p-5 text-[12px] text-ink/60">
                Baru ada <strong>{data.history_days_available}</strong> hari data snapshot riil sejauh ini — perkiraan butuh minimal{" "}
                {data.min_samples_required} sampel per hari-dalam-minggu sebelum bisa ditampilkan. Ini akan otomatis terisi seiring
                berjalannya waktu, tidak perlu tindakan apa pun.
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="14 Hari ke Depan" subtitle={`Berdasarkan ${data.history_days_available} hari riwayat snapshot riil`} />
            <div className="p-3 sm:p-4 overflow-x-auto">
              <div className="flex gap-2 min-w-max">
                {data.forecast.map((d) => (
                  <div key={d.date} className="w-[110px] shrink-0 rounded-xl border border-ink/[0.07] p-2.5 text-center">
                    <div className="text-[10px] text-ink/40 uppercase tracking-wide mb-1">
                      {WEEKDAY_NAMES[d.weekday]} · {fmtDate(d.date)}
                    </div>
                    {d.forecast_occupancy_pct !== null ? (
                      <div className="text-lg font-serif font-medium text-ink">{d.forecast_occupancy_pct}%</div>
                    ) : (
                      <div className="text-[10.5px] text-ink/35 italic">belum cukup data</div>
                    )}
                    <div className="text-[9.5px] text-ink/30 mt-1">{d.sample_count} sampel</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </>
      )}
    </AdminShell>
  );
}
