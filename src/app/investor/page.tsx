"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { AppHome, type TabItem } from "@/components/AppHome";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtCurrency, currentPeriod } from "@/lib/format";
import type { Report } from "@/lib/types";

/**
 * Beranda investor bergaya aplikasi (permintaan owner 14 Sep 2026).
 *
 * Tata letaknya ada di AppHome dan dipakai bersama dengan beranda admin;
 * berkas ini hanya menyiapkan tab bar dan satu kartu tambahan berisi angka
 * yang benar-benar dicari investor saat membuka aplikasi: berapa yang ia
 * terima bulan ini.
 *
 * Aturan yang tetap berlaku di sini, sama seperti versi lama: investor
 * berskema pemasukan tetap TIDAK melihat jaminan Rp 5 juta, dan tidak ada
 * investor yang melihat pembagian antar-investor.
 */

const TABS: TabItem[] = [
  { href: "/investor", label: "Beranda", icon: "⌂" },
  { href: "/investor/pendapatan", label: "Pendapatan", icon: "◎" },
  { href: "/investor/menginap-gratis", label: "Menginap", icon: "✦" },
  { href: "/investor/laporan", label: "Laporan", icon: "▤" },
  { href: "/investor/notifikasi", label: "Notifikasi", icon: "◉" },
];

// Periode dihitung dari kalender WIB (lihat currentPeriod di format.ts);
// versi UTC-nya menjawab bulan lalu selama 00:00-07:00 WIB tanggal 1.
const periodeBulanIni = currentPeriod;

export default function InvestorHomePage() {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    api
      .get<Report>(`/report?unit_id=${unitId}&periode=${periodeBulanIni()}`)
      .then(setReport)
      .catch(() => setReport(null));
  }, [unitId]);

  const pemasukanTetap = report?.pemasukan_tetap ?? null;
  const bagianAnda = report?.bagian_anda ?? report?.per_investor_amount ?? report?.owner_amount ?? 0;

  return (
    <AppHome tabs={TABS} tautanReservasi="/investor/laporan">
      <section className="rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <div className="px-4 py-3 bg-slate-50 text-[13px] font-semibold text-slate-700">
          {pemasukanTetap !== null ? "Pemasukan Anda" : "Bagian Anda"}
        </div>
        <div className="px-4 py-4">
          <div className="text-[28px] font-light text-slate-900 leading-none">{fmtCurrency(bagianAnda)}</div>
          <div className="text-[11.5px] text-slate-500 mt-1.5">
            {pemasukanTetap !== null
              ? "Angka tetap setiap bulan sesuai skema pembelian Anda"
              : "Bulan ini"}
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-slate-100">
          <AngkaKecil label="Pendapatan villa" nilai={report?.gross_revenue} />
          <AngkaKecil label="Laba bersih" nilai={report?.net ?? report?.gross_profit} garisKiri />
        </div>
      </section>

      <div className="flex justify-center">
        <Link href="/investor/pendapatan" className="text-[12.5px] text-blue-700 font-medium py-2">
          Lihat rincian pendapatan →
        </Link>
      </div>
    </AppHome>
  );
}

function AngkaKecil({
  label,
  nilai,
  garisKiri,
}: {
  label: string;
  nilai: number | undefined;
  garisKiri?: boolean;
}) {
  return (
    <div className={`px-4 py-3 ${garisKiri ? "border-l border-slate-100" : ""}`}>
      <div className="text-[10.5px] text-slate-400 mb-0.5">{label}</div>
      <div className="text-[14px] font-medium text-slate-800">{fmtCurrency(nilai)}</div>
    </div>
  );
}
