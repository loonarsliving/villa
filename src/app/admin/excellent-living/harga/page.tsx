"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../../_shell";
import { localApi } from "@/lib/api";
import { fmtCurrencyFull, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { inputCls } from "@/components/Modal";

interface HargaTipe { room_type_id: string; kode: string; nama: string; cloudbeds_room_type_id: string | null; per_malam: { date: string; rate: number | null }[] }

function tambahHari(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/**
 * Kalender harga Excellent Living = harga yang diatur di Cloudbeds (dan
 * dikirim Cloudbeds ke semua OTA). Hanya baca: ubah harga di Cloudbeds.
 */
export default function ElHargaPage() {
  const [mulai, setMulai] = useState(todayISO());
  const [data, setData] = useState<HargaTipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    setData(null);
    setError(null);
    localApi<{ tipe: HargaTipe[] }>(`/api/el/harga?${new URLSearchParams({ checkin: mulai, checkout: tambahHari(mulai, 30) })}`)
      .then((r) => !batal && setData(r.tipe))
      .catch((e) => !batal && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      batal = true;
    };
  }, [mulai]);

  const tanggal = data?.[0]?.per_malam.map((m) => m.date) ?? [];

  return (
    <AdminShell pageTitle="Harga Excellent Living" pageSub="Dibaca langsung dari Cloudbeds — ubah harga di Cloudbeds">
      <Card>
        <CardHeader
          title="Kalender Harga 30 Hari"
          subtitle="Harga per malam per tipe kamar, sama dengan yang dikirim Cloudbeds ke OTA. Dipakai otomatis di form booking front desk EL."
          action={<input type="date" className={inputCls} value={mulai} onChange={(e) => e.target.value && setMulai(e.target.value)} />}
        />
        {error ? (
          <div className="px-4 sm:px-5 pb-4 text-[12px] text-ruby-500">Gagal membaca harga Cloudbeds: {error}</div>
        ) : !data ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty label="Belum ada tipe kamar aktif" />
        ) : (
          <div className="overflow-x-auto">
            <table className="text-[11.5px] min-w-full">
              <thead>
                <tr className="text-ink/50">
                  <th className="sticky left-0 bg-white px-3 py-2 text-left">Tipe</th>
                  {tanggal.map((d) => {
                    const t = new Date(`${d}T00:00:00Z`);
                    return (
                      <th key={d} className="px-2 py-2 text-right whitespace-nowrap">
                        {HARI[t.getUTCDay()]} {d.slice(8)}/{d.slice(5, 7)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.05]">
                {data.map((t) => (
                  <tr key={t.room_type_id}>
                    <td className="sticky left-0 bg-white px-3 py-2 font-semibold text-ink whitespace-nowrap">
                      {t.nama}
                      {!t.cloudbeds_room_type_id && <div className="text-[10px] font-normal text-gold-600">belum terhubung ke Cloudbeds</div>}
                    </td>
                    {t.per_malam.map((m) => (
                      <td key={m.date} className="px-2 py-2 text-right whitespace-nowrap text-ink/70">
                        {m.rate === null ? <span className="text-ink/25">—</span> : fmtCurrencyFull(m.rate).replace("Rp", "").trim()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
