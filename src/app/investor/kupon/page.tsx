"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InvestorShell } from "../_shell";
import { api } from "@/lib/api";
import { Card, CardHeader, Loading } from "@/components/Card";
import { fmtCurrencyFull } from "@/lib/format";
import { type JawabanKupon, pesanBagikan, tautanDenganKode } from "./types";

/**
 * Kupon diskon investor 20% Loonars Excellent Living (owner 2026-11-08).
 *
 * Lima kode yang selalu terisi ulang: villa-api membuat kode baru begitu satu
 * kode dipakai. Halaman ini tidak menghitung apa pun sendiri -- status dan
 * angka diskonnya datang apa adanya dari villa-api.
 */

const LABEL_STATUS: Record<JawabanKupon["riwayat"][number]["status"], string> = {
  lunas: "Lunas",
  menunggu_pembayaran: "Menunggu bayar",
  batal: "Batal",
};

function tgl(iso: string | null) {
  if (!iso) return "-";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function KuponInvestorPage() {
  const [data, setData] = useState<JawabanKupon | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [disalin, setDisalin] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<JawabanKupon>("/investor/kupon")
      .then(setData)
      .catch((e: unknown) => setGalat(e instanceof Error ? e.message : "Gagal memuat kupon"));
  }, []);

  async function salin(kode: string, teks: string) {
    try {
      await navigator.clipboard.writeText(teks);
      setDisalin(kode);
      setTimeout(() => setDisalin((k) => (k === kode ? null : k)), 1800);
    } catch {
      setGalat("Gagal menyalin -- tekan lama kodenya untuk menyalin manual.");
    }
  }

  return (
    <InvestorShell pageTitle="Kupon Diskon" pageSub="Diskon 20% Loonars Excellent Living untuk Anda bagikan">
      <div className="space-y-4">
        <Card>
          <div className="px-4 sm:px-5 py-4 bg-gradient-to-br from-ink to-[#2a2418] text-white">
            <div className="text-[10px] tracking-[0.22em] uppercase text-gold-400">Priority Investor Loonars</div>
            <div className="font-serif text-[26px] leading-tight mt-1">Diskon {data?.persen ?? 20}% Excellent Living</div>
            <div className="text-[11.5px] text-white/60 mt-1.5 leading-relaxed">
              Bagikan kode ke keluarga, teman, atau relasi. Kode dipakai di kolom <b className="text-white/85">kode referral</b> saat
              memesan di loonars.id. Kode yang terpakai langsung diganti yang baru — Anda selalu punya 5 kode.
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Kode Siap Dibagikan" subtitle={data ? `${data.tersedia.length} kode` : undefined} />
          {galat && <div className="px-4 sm:px-5 py-4 text-[11.5px] text-ruby-500">{galat}</div>}
          {!data && !galat && <Loading label="Memuat kode…" />}
          {data &&
            data.tersedia.map((k) => (
              <div key={k.kode} className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
                <div className="grow min-w-[9rem]">
                  <div className="font-mono tracking-[0.12em] text-[14px] text-ink select-all">{k.kode}</div>
                  <div className="text-[9.5px] text-ink/50 mt-0.5">Diskon {k.persen}% · sekali pakai</div>
                </div>
                <button
                  type="button"
                  onClick={() => salin(k.kode, k.kode)}
                  className="shrink-0 text-[10.5px] px-2.5 py-1.5 rounded-lg border border-ink/10 text-ink/70 hover:bg-base-800"
                >
                  {disalin === k.kode ? "Tersalin ✓" : "Salin"}
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(pesanBagikan(data.tautan_pemesanan, k.kode, k.persen))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[10.5px] px-2.5 py-1.5 rounded-lg bg-sage-500 text-white hover:bg-sage-600"
                >
                  Bagikan via WA
                </a>
                <button
                  type="button"
                  onClick={() => salin(`${k.kode}-link`, tautanDenganKode(data.tautan_pemesanan, k.kode))}
                  className="shrink-0 text-[10.5px] px-2.5 py-1.5 rounded-lg border border-ink/10 text-ink/50 hover:bg-base-800"
                >
                  {disalin === `${k.kode}-link` ? "Tautan tersalin ✓" : "Salin tautan"}
                </button>
              </div>
            ))}
          {data && (
            <div className="px-4 sm:px-5 py-3 text-[10.5px] text-ink/40 leading-relaxed border-t border-ink/[0.05]">{data.aturan}</div>
          )}
        </Card>

        <Card>
          <CardHeader title="Kode yang Sudah Dipakai" />
          {data && data.riwayat.length === 0 && <Loading label="Belum ada kode yang dipakai" />}
          {data &&
            data.riwayat.map((r) => (
              <div key={r.kode} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
                <div className="grow min-w-0">
                  <div className={`font-mono tracking-[0.12em] text-[13px] ${r.status === "batal" ? "line-through text-ink/50" : "text-ink/70"}`}>{r.kode}</div>
                  <div className="text-[9.5px] text-ink/55 mt-0.5">
                    {r.properti} · {tgl(r.tgl_checkin)} – {tgl(r.tgl_checkout)}
                    {r.diskon > 0 && ` · tamu hemat ${fmtCurrencyFull(r.diskon)}`}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-[9.5px] px-2 py-0.5 rounded border ${
                    r.status === "lunas" ? "text-sage-500 border-sage-500/30" : r.status === "batal" ? "text-ink/50 border-ink/10" : "text-gold-500 border-gold-500/30"
                  }`}
                >
                  {LABEL_STATUS[r.status]}
                </span>
              </div>
            ))}
        </Card>

        <Link
          href="/investor/kartu"
          className="block text-center text-[11.5px] text-ink/60 border border-ink/10 rounded-2xl px-4 py-3 hover:bg-base-800"
        >
          Untuk Loonars Coffee &amp; Loonars Beauty, tunjukkan <b className="text-ink">Kartu Priority Investor</b> di kasir →
        </Link>
      </div>
    </InvestorShell>
  );
}
