"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "./_shell";
import { api } from "@/lib/api";
import { fmtCurrency } from "@/lib/format";
import { Loading } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { AdminOverview } from "@/lib/types";

export default function AdminOverviewPage() {
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AdminOverview>("/admin/overview")
      .then(setOv)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell pageTitle="Overview" pageSub="Ringkasan seluruh properti">
      {loading ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total Unit" value={String(ov?.total_unit ?? 0)} accent="gold" />
          <StatCard label="Tersedia" value={String(ov?.available ?? 0)} accent="sage" />
          <StatCard label="Terisi" value={String(ov?.occupied ?? 0)} accent="gold" />
          <StatCard label="Gross Revenue Bulan Ini" value={fmtCurrency(ov?.gross_revenue_bulan_ini)} accent="sage" />
          <StatCard label="Total Pengguna" value={String(ov?.total_user ?? 0)} />
          <StatCard label="Pengguna Aktif" value={String(ov?.user_aktif ?? 0)} accent="sage" />
          <StatCard label="Cloudbeds Belum Dipetakan" value={String(ov?.cloudbeds_belum_dipetakan ?? 0)} accent={ov?.cloudbeds_belum_dipetakan ? "ruby" : "sage"} />
          <StatCard label="WA Gagal Terkirim" value={String(ov?.wa_gagal_terkirim ?? 0)} accent={ov?.wa_gagal_terkirim ? "ruby" : "sage"} />
        </div>
      )}
    </AdminShell>
  );
}
