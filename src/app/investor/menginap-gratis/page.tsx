"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { api } from "@/lib/api";
import { Card, CardHeader, Loading } from "@/components/Card";
import type { BuktiMenginapData } from "@/lib/pdf/buktiMenginapPdf";

/**
 * Dua belas kode menginap gratis milik investor yang sedang login.
 *
 * Statusnya datang apa adanya dari villa-api dan TIDAK dihitung ulang di
 * sini. Halaman ini sengaja tidak tahu aturan mainnya -- kalau ia ikut
 * menghitung "sudah lewat bulannya?", suatu hari tampilan dan kenyataan akan
 * berbeda pendapat, dan yang dipercaya investor adalah yang dilihatnya.
 */

type Voucher = {
  kode: string;
  bulan: string;
  status: "tersedia" | "terpakai" | "hangus";
  dicoret: boolean;
  dipakai_pada: string | null;
  unit: string | null;
  /** Ada kalau Bukti Menginap untuk kode ini bisa dicetak. */
  bukti_booking_id?: string | null;
};

type Jawaban = {
  vouchers: Voucher[];
  tersedia: number;
  terpakai: number;
  hangus: number;
  aturan: string;
};

const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function labelBulan(bulan: string): string {
  const [tahun, bln] = bulan.split("-");
  const idx = Number(bln) - 1;
  return idx >= 0 && idx < 12 ? `${NAMA_BULAN[idx]} ${tahun}` : bulan;
}

export default function MenginapGratisPage() {
  const [data, setData] = useState<Jawaban | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [mencetak, setMencetak] = useState<string | null>(null);
  const [galatCetak, setGalatCetak] = useState<string | null>(null);

  // Bukti Menginap yang sama dengan di loonars.id, tapi bisa diambil dari
  // perangkat mana pun selama investor login (owner 2026-11-11).
  async function cetakBukti(bookingId: string) {
    if (mencetak) return;
    setMencetak(bookingId);
    setGalatCetak(null);
    try {
      const data = await api.get<BuktiMenginapData>(`/investor/bukti-menginap?booking_id=${encodeURIComponent(bookingId)}`);
      const { buildBuktiMenginapPdf } = await import("@/lib/pdf/buktiMenginapPdf");
      const doc = await buildBuktiMenginapPdf(data);
      doc.save(`Bukti-Menginap-${data.no_bukti}.pdf`);
    } catch (e: unknown) {
      setGalatCetak(e instanceof Error ? e.message : "Gagal membuat Bukti Menginap");
    } finally {
      setMencetak(null);
    }
  }

  useEffect(() => {
    api
      .get<Jawaban>("/investor/vouchers")
      .then(setData)
      .catch((e: unknown) => setGalat(e instanceof Error ? e.message : "Gagal memuat kode"));
  }, []);

  return (
    <InvestorShell pageTitle="Menginap Gratis" pageSub="12 kode menginap gratis Anda">
      <Card>
        <CardHeader title="Kode Menginap Gratis" />

        {galat && <div className="px-4 sm:px-5 py-4 text-[11.5px] text-ruby-500">{galat}</div>}
        {!data && !galat && <Loading label="Memuat kode…" />}

        {data && (
          <>
            <div className="flex gap-4 px-4 sm:px-5 py-3 border-b border-ink/[0.05] text-[11.5px]">
              <span className="text-ink">
                <b>{data.tersedia}</b> tersedia
              </span>
              <span className="text-ink/40">{data.terpakai} terpakai</span>
              <span className="text-ink/40">{data.hangus} hangus</span>
            </div>

            {galatCetak && <div className="px-4 sm:px-5 py-2 text-[11px] text-ruby-500 border-b border-ink/[0.05]">{galatCetak}</div>}

            {data.vouchers.length === 0 ? (
              <Loading label="Belum ada kode untuk akun ini" />
            ) : (
              data.vouchers.map((v) => (
                <div key={v.kode} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
                  <div className="grow min-w-0">
                    <div
                      className={`font-mono tracking-[0.12em] text-[13px] ${
                        v.dicoret ? "line-through text-ink/30" : "text-ink"
                      }`}
                    >
                      {v.kode}
                    </div>
                    <div className="text-[9.5px] text-ink/30 mt-0.5">
                      {labelBulan(v.bulan)}
                      {v.status === "terpakai" && v.dipakai_pada && ` · dipakai ${v.dipakai_pada}${v.unit ? ` di Unit ${v.unit}` : ""}`}
                      {v.status === "hangus" && " · hangus, bulannya sudah lewat"}
                    </div>
                    {v.bukti_booking_id && (
                      <button
                        type="button"
                        onClick={() => v.bukti_booking_id && cetakBukti(v.bukti_booking_id)}
                        disabled={!!mencetak}
                        className="mt-1.5 text-[10.5px] px-2.5 py-1 rounded border border-gold-500/40 text-gold-500 hover:bg-gold-500/10 disabled:opacity-50"
                      >
                        {mencetak === v.bukti_booking_id ? "Menyiapkan…" : "Cetak Bukti Menginap (PDF)"}
                      </button>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-[9.5px] px-2 py-0.5 rounded border ${
                      v.status === "tersedia"
                        ? "text-gold-500 border-gold-500/30"
                        : "text-ink/30 border-ink/10"
                    }`}
                  >
                    {v.status === "tersedia" ? "Tersedia" : v.status === "terpakai" ? "Terpakai" : "Hangus"}
                  </span>
                </div>
              ))
            )}

            <div className="px-4 sm:px-5 py-3 text-[10.5px] text-ink/40 leading-relaxed border-t border-ink/[0.05]">
              {data.aturan} Kode dimasukkan saat memesan di loonars.id.
            </div>
          </>
        )}
      </Card>
    </InvestorShell>
  );
}
