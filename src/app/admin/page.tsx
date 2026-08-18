"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "./_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency } from "@/lib/format";
import { Loading } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { AdminOverview } from "@/lib/types";

export default function AdminOverviewPage() {
  const { user } = useAuth();
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AdminOverview>("/admin/overview")
      .then(setOv)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell pageTitle="Beranda" pageSub="Ringkasan seluruh properti">
      <div className="mb-5">
        <div className="text-[11px] text-ink/40">Melihat laporan</div>
        <div className="font-serif text-2xl sm:text-3xl font-medium text-ink">
          Halo, {user?.nama || "Administrator"}
        </div>
      </div>

      <div className="relative mb-5">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/30">⌕</span>
        <input
          placeholder="Cari unit, transaksi, atau pengguna…"
          className="w-full bg-gold-500/10 rounded-2xl py-3 pl-10 pr-4 text-[13px] text-ink placeholder:text-ink/40 outline-none"
        />
      </div>

      {loading ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Pemasukan" value={fmtCurrency(ov?.gross_revenue_bulan_ini)} sub="Bulan ini" accent="azure" icon="↓" />
          <StatCard label="Pengeluaran" value={String(ov?.wa_gagal_terkirim ?? 0)} sub="WA gagal terkirim" accent="ruby" icon="↑" />
          <StatCard label="Total Unit" value={String(ov?.total_unit ?? 0)} sub={`${ov?.available ?? 0} tersedia`} accent="gold" icon="▤" />
          <StatCard label="Terisi" value={String(ov?.occupied ?? 0)} sub="dari total unit" accent="sage" icon="✓" />
          <StatCard label="Total Pengguna" value={String(ov?.total_user ?? 0)} accent="neutral" />
          <StatCard label="Pengguna Aktif" value={String(ov?.user_aktif ?? 0)} accent="sage" />
          <StatCard
            label="Cloudbeds Belum Dipetakan"
            value={String(ov?.cloudbeds_belum_dipetakan ?? 0)}
            accent={ov?.cloudbeds_belum_dipetakan ? "ruby" : "sage"}
          />
          <StatCard
            label="WA Gagal Terkirim"
            value={String(ov?.wa_gagal_terkirim ?? 0)}
            accent={ov?.wa_gagal_terkirim ? "ruby" : "sage"}
          />
        </div>
      )}

      {!loading && (
        <div className="mt-3.5 bg-base-900 border border-ink/[0.06] rounded-2xl shadow-sm shadow-ink/[0.04] p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-serif text-base font-medium text-ink">Total Penghuni Aktif</div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gold-500/15 flex items-center justify-center text-xl shrink-0">👥</div>
            <div>
              <div className="font-serif text-3xl font-medium text-ink leading-none">{ov?.occupied ?? 0}</div>
              <div className="text-[11px] text-ink/40 mt-1">Unit terisi dari {ov?.total_unit ?? 0} total unit</div>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
