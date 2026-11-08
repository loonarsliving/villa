"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InvestorShell } from "../_shell";
import { api } from "@/lib/api";
import { Loading } from "@/components/Card";
import type { JawabanKupon } from "../kupon/types";
import { lebarCode128B } from "@/lib/barcode128";

/**
 * Kartu Priority Investor Loonars (owner 2026-11-08): ditunjukkan langsung
 * dari layar ke kasir Loonars Coffee / Loonars Beauty. Sengaja TANPA angka
 * diskon di kartu (owner 2026-11-08): besaran harga khusus diatur kasir.
 * Kartu memuat barcode Code 128 berisi nomor anggota (PI-xxxxxx, dari id
 * akun, tidak berubah) untuk di-scan sistem kasir Coffee nanti; nomornya
 * sendiri tidak ditulis di kartu (owner). Jangan ubah formatnya tanpa owner.
 *
 * Jam dan kilau pada kartu terus bergerak supaya kasir bisa membedakan kartu
 * asli di dashboard dari tangkapan layar atau foto. Tidak ada pencatatan
 * pemakaian di sistem -- kasir yang memberi diskonnya.
 */

function Jam() {
  const [kini, setKini] = useState<Date | null>(null);
  useEffect(() => {
    setKini(new Date());
    const t = setInterval(() => setKini(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!kini) return <span>&nbsp;</span>;
  return (
    <span className="tabular-nums">
      {kini.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} ·{" "}
      {kini.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

/** Barcode Code 128 sebagai SVG; latar putih + zona sunyi 10 modul agar mudah dipindai. */
function Barcode({ nilai }: { nilai: string }) {
  const lebar = lebarCode128B(nilai);
  const sunyi = 10;
  const total = lebar.reduce((a, b) => a + b, 0) + sunyi * 2;
  let x = sunyi;
  const batang: { x: number; w: number }[] = [];
  lebar.forEach((w, i) => {
    if (i % 2 === 0) batang.push({ x, w });
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" className="block w-full h-full" role="img" aria-label="Barcode kartu investor" shapeRendering="crispEdges">
      <rect width={total} height={40} fill="#fff" />
      {batang.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={40} fill="#000" />
      ))}
    </svg>
  );
}

function KartuPriority({ kartu }: { kartu: JawabanKupon["kartu"] }) {
  return (
    <div className="relative mx-auto w-full max-w-[420px] aspect-[1.586/1] rounded-[22px] overflow-hidden text-white shadow-xl shadow-ink/30 select-none">
      {/* Latar: hitam pekat dengan cahaya emas */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,#5a4520_0%,#1d1a14_45%,#0b0b0d_100%)]" />
      <div className="absolute -right-16 -bottom-20 w-64 h-64 rounded-full border border-gold-400/15" />
      <div className="absolute -right-6 -bottom-10 w-44 h-44 rounded-full border border-gold-400/10" />
      {/* Kilau bergerak (anti tangkapan layar) */}
      <div className="absolute inset-0 kartu-kilau pointer-events-none" />

      <div className="relative h-full flex flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-serif text-[22px] sm:text-[24px] tracking-[0.32em] leading-none text-gold-400">LOONARS</div>
            <div className="text-[8.5px] sm:text-[9px] tracking-[0.34em] uppercase text-white/55 mt-1.5">Priority Investor</div>
          </div>
        </div>

        <div className="mt-auto">
          <div className="font-serif italic text-[13px] sm:text-[14px] text-gold-400/90">Priority Investor Loonars</div>
          <div className="text-[17px] sm:text-[19px] font-semibold tracking-wide mt-0.5 truncate">{kartu.nama ?? "Investor Loonars"}</div>
          <div className="flex items-end justify-between gap-3 mt-2.5">
            <div className="min-w-0">
              <div className="text-[8px] tracking-[0.2em] uppercase text-white/40">Berlaku di</div>
              <div className="text-[10.5px] text-white/85 leading-tight">
                {kartu.berlaku_di.map((b) => (
                  <div key={b}>{b}</div>
                ))}
              </div>
            </div>
            <div className="shrink-0 w-[46%] h-[46px] sm:h-[52px] bg-white rounded-md p-1">
              <Barcode nilai={kartu.no_anggota} />
            </div>
          </div>
          <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center gap-1.5 text-[9.5px] text-white/60">
            <span className="w-1.5 h-1.5 rounded-full bg-sage-400 animate-pulse" aria-hidden="true" />
            <span>Kartu aktif ·</span>
            <Jam />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function KartuPriorityPage() {
  const [data, setData] = useState<JawabanKupon | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<JawabanKupon>("/investor/kupon")
      .then(setData)
      .catch((e: unknown) => setGalat(e instanceof Error ? e.message : "Gagal memuat kartu"));
  }, []);

  return (
    <InvestorShell pageTitle="Kartu Priority" pageSub="Tunjukkan di kasir Loonars Coffee & Loonars Beauty">
      <style>{`
        .kartu-kilau { background: linear-gradient(115deg, transparent 35%, rgba(217,184,118,.18) 48%, rgba(255,255,255,.10) 50%, transparent 62%); background-size: 260% 100%; animation: kartuKilau 4.5s linear infinite; }
        @keyframes kartuKilau { from { background-position: 130% 0; } to { background-position: -130% 0; } }
        @media (prefers-reduced-motion: reduce) { .kartu-kilau { animation-duration: 12s; } }
      `}</style>
      {galat && <div className="text-[11.5px] text-ruby-500 mb-3">{galat}</div>}
      {!data && !galat && <Loading label="Memuat kartu…" />}
      {data && (
        <div className="space-y-4">
          <KartuPriority kartu={data.kartu} />
          <div className="max-w-[420px] mx-auto text-[11px] text-ink/55 leading-relaxed space-y-2">
            <p>
              <b className="text-ink">Cara pakai:</b> buka halaman ini dan tunjukkan kartu langsung dari layar ke kasir Loonars Coffee atau
              Loonars Beauty.
            </p>
            <p>Jam pada kartu berjalan setiap detik. Kasir hanya menerima kartu yang hidup di layar, bukan foto atau tangkapan layar.</p>
            <p>
              Untuk menginap di Loonars Excellent Living, pakai{" "}
              <Link href="/investor/kupon" className="text-gold-600 underline underline-offset-2">
                kode kupon diskon
              </Link>{" "}
              di loonars.id.
            </p>
          </div>
        </div>
      )}
    </InvestorShell>
  );
}
