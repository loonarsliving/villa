"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../../_shell";
import { localApi } from "@/lib/api";
import { fmtCurrencyFull, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { inputCls, Btn } from "@/components/Modal";
import { useToast } from "@/lib/toast";

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
interface SetelanAi {
  autopush: boolean;
  harga_dasar: Record<string, Record<string, number>>;
  harga_dasar_diambil: string | null;
  terakhir_jalan?: string;
  rekomendasi?: Record<string, { date: string; rate: number; alasan: string; guardrail: string }[]>;
  tipe: { id: string; code: string; name: string; min_rate: number | null; max_rate: number | null }[];
}

export default function ElHargaPage() {
  const toast = useToast();
  const [mulai, setMulai] = useState(todayISO());
  const [data, setData] = useState<HargaTipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<SetelanAi | null>(null);
  const [batas, setBatas] = useState<Record<string, { min: string; max: string }>>({});
  const [busy, setBusy] = useState(false);

  function muatAi() {
    localApi<SetelanAi>("/api/admin/el-harga-ai")
      .then((r) => {
        setAi(r);
        setBatas(Object.fromEntries(r.tipe.map((t) => [t.code, { min: String(t.min_rate ?? ""), max: String(t.max_rate ?? "") }])));
      })
      .catch(() => setAi(null));
  }
  useEffect(muatAi, []);

  async function aksi(body: object, pesan: string) {
    setBusy(true);
    try {
      await localApi("/api/admin/el-harga-ai", { method: "POST", body: JSON.stringify(body) });
      toast("✓", "Tersimpan", pesan, "sage");
      muatAi();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    } finally {
      setBusy(false);
    }
  }
  const rekomendasiDari = (tipeId: string, date: string) => {
    const kode = ai?.tipe.find((t) => t.id === tipeId)?.code;
    return kode ? ai?.rekomendasi?.[kode]?.find((r) => r.date === date) : undefined;
  };

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
    <AdminShell pageTitle="Harga Excellent Living" pageSub="Harga Cloudbeds + dynamic pricing AI">
      <Card className="mb-5">
        <CardHeader
          title="Dynamic Pricing AI"
          subtitle={
            ai
              ? `Harga dasar = harga Cloudbeds yang diambil ${ai.harga_dasar_diambil ?? "(belum diambil)"}; dihitung tiap malam, selalu di antara batas bawah dan atas. ${ai.terakhir_jalan ? `Terakhir dihitung ${new Date(ai.terakhir_jalan).toLocaleString("id-ID")}.` : "Belum pernah dihitung."}`
              : "Memuat..."
          }
          action={<Btn disabled={busy} onClick={() => aksi({ aksi: "jalankan" }, "Rekomendasi dihitung ulang (tidak dikirim ke Cloudbeds).")}>Hitung ulang</Btn>}
        />
        {ai && (
          <div className="px-4 sm:px-5 pb-4 space-y-3 text-[12px]">
            <div className={`rounded-lg px-3 py-2 ${ai.autopush ? "bg-sage-500/10 text-sage-700" : "bg-gold-500/10 text-gold-700"}`}>
              {ai.autopush
                ? "Auto-push MENYALA: harga AI dikirim ke Cloudbeds (dan semua OTA) tiap malam."
                : "Auto-push MATI: harga AI hanya rekomendasi (baris kuning di kalender), harga Cloudbeds tidak diubah."}
              <button
                className="ml-2 underline"
                disabled={busy}
                onClick={() => {
                  const nyala = !ai.autopush;
                  if (nyala && !confirm("Nyalakan auto-push? Harga AI akan dikirim ke Cloudbeds EL tiap malam, selalu di antara batas bawah dan atas.")) return;
                  aksi({ aksi: "autopush", nilai: nyala }, nyala ? "Auto-push EL dinyalakan." : "Auto-push EL dimatikan.");
                }}
              >
                {ai.autopush ? "Matikan" : "Nyalakan"}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="text-[11.5px] min-w-full">
                <thead>
                  <tr className="text-ink/50">
                    <th className="px-2 py-1 text-left">Tipe</th>
                    <th className="px-2 py-1 text-right">Batas bawah</th>
                    <th className="px-2 py-1 text-right">Batas atas</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {ai.tipe.map((t) => (
                    <tr key={t.code}>
                      <td className="px-2 py-1 font-semibold text-ink whitespace-nowrap">{t.name}</td>
                      <td className="px-2 py-1"><input type="number" className={inputCls} value={batas[t.code]?.min ?? ""} onChange={(e) => setBatas({ ...batas, [t.code]: { ...batas[t.code], min: e.target.value } })} /></td>
                      <td className="px-2 py-1"><input type="number" className={inputCls} value={batas[t.code]?.max ?? ""} onChange={(e) => setBatas({ ...batas, [t.code]: { ...batas[t.code], max: e.target.value } })} /></td>
                      <td className="px-2 py-1">
                        <Btn disabled={busy} onClick={() => aksi({ aksi: "batas", kode: t.code, min_rate: Number(batas[t.code]?.min), max_rate: Number(batas[t.code]?.max) }, `Batas ${t.name} disimpan.`)}>Simpan</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
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
                  <th className="sticky left-0 bg-base-900 px-3 py-2 text-left">Tipe</th>
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
                    <td className="sticky left-0 bg-base-900 px-3 py-2 font-semibold text-ink whitespace-nowrap">
                      {t.nama}
                      {!t.cloudbeds_room_type_id && <div className="text-[10px] font-normal text-gold-600">belum terhubung ke Cloudbeds</div>}
                    </td>
                    {t.per_malam.map((m) => {
                      const rek = rekomendasiDari(t.room_type_id, m.date);
                      return (
                        <td key={m.date} className="px-2 py-2 text-right whitespace-nowrap text-ink/70" title={rek?.alasan}>
                          {m.rate === null ? <span className="text-ink/45">—</span> : fmtCurrencyFull(m.rate).replace("Rp", "").trim()}
                          {rek && <div className="text-[10px] text-gold-600">AI {fmtCurrencyFull(rek.rate).replace("Rp", "").trim()}</div>}
                        </td>
                      );
                    })}
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
