"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { AppHome, type TabItem } from "@/components/AppHome";
import { api } from "@/lib/api";
import { fmtCurrency } from "@/lib/format";
import type { AdminOverview } from "@/lib/types";

/**
 * Beranda admin bergaya aplikasi (permintaan owner 14 Sep 2026).
 *
 * Tata letaknya ada di AppHome, dipakai bersama beranda investor. Yang
 * ditambahkan di sini adalah dua hal yang hanya berarti bagi admin:
 * pendapatan bulan berjalan, dan daftar hal yang PERLU DITINDAKLANJUTI --
 * Cloudbeds yang belum terpetakan dan WhatsApp yang gagal terkirim.
 *
 * Keduanya sengaja ditampilkan hanya ketika angkanya di atas nol. Baris
 * "0 gagal" yang selalu ada akan berhenti dibaca dalam seminggu, dan setelah
 * itu angka yang bukan nol pun ikut tidak terlihat.
 */

const TABS: TabItem[] = [
  { href: "/admin", label: "Beranda", icon: "⌂" },
  { href: "/admin/revenue", label: "Revenue", icon: "◎" },
  { href: "/admin/pricing-calendar", label: "Harga", icon: "🗓" },
  { href: "/admin/guests", label: "Tamu", icon: "◍" },
  { href: "/admin/users", label: "Pengguna", icon: "⚙" },
];

export default function AdminHomePage() {
  const [ov, setOv] = useState<AdminOverview | null>(null);

  useEffect(() => {
    api
      .get<AdminOverview>("/admin/overview")
      .then(setOv)
      .catch(() => setOv(null));
  }, []);

  const perluTindakan = [
    { label: "Cloudbeds belum dipetakan", nilai: ov?.cloudbeds_belum_dipetakan ?? 0, href: "/admin/cloudbeds" },
    { label: "WhatsApp gagal terkirim", nilai: ov?.wa_gagal_terkirim ?? 0, href: "/admin/wa-log" },
  ].filter((x) => x.nilai > 0);

  return (
    <AppHome tabs={TABS} tautanReservasi="/front-desk/booking">
      <section className="rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <div className="px-4 py-3 bg-slate-50 text-[13px] font-semibold text-slate-700">Pendapatan Bulan Ini</div>
        <div className="px-4 py-4">
          <div className="text-[28px] font-light text-slate-900 leading-none">
            {fmtCurrency(ov?.gross_revenue_bulan_ini)}
          </div>
          <div className="text-[11.5px] text-slate-500 mt-1.5">Seluruh properti</div>
        </div>
        <div className="grid grid-cols-2 border-t border-slate-100">
          <div className="px-4 py-3">
            <div className="text-[10.5px] text-slate-400 mb-0.5">Unit terisi</div>
            <div className="text-[14px] font-medium text-slate-800">
              {ov ? `${ov.occupied} / ${ov.total_unit}` : "—"}
            </div>
          </div>
          <div className="px-4 py-3 border-l border-slate-100">
            <div className="text-[10.5px] text-slate-400 mb-0.5">Pengguna aktif</div>
            <div className="text-[14px] font-medium text-slate-800">
              {ov ? `${ov.user_aktif} / ${ov.total_user}` : "—"}
            </div>
          </div>
        </div>
      </section>

      {perluTindakan.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden mb-4">
          <div className="px-4 py-3 text-[13px] font-semibold text-amber-800">Perlu Ditindaklanjuti</div>
          {perluTindakan.map((x) => (
            <Link
              key={x.href}
              href={x.href}
              className="flex items-center gap-3 px-4 py-3 border-t border-amber-200/60 text-amber-900"
            >
              <span className="text-[18px] font-semibold tabular-nums w-7">{x.nilai}</span>
              <span className="grow text-[13.5px]">{x.label}</span>
              <span className="text-amber-500">›</span>
            </Link>
          ))}
        </section>
      )}

      <div className="flex justify-center">
        <Link href="/admin/revenue" className="text-[12.5px] text-blue-700 font-medium py-2">
          Lihat laporan lengkap →
        </Link>
      </div>
    </AppHome>
  );
}
