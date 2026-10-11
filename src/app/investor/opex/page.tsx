"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency, currentPeriod, periodLabel } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading } from "@/components/Card";
import { pendapatanInvestor } from "@/lib/investorPendapatan";
import type { Report } from "@/lib/types";

export default function OpexPage() {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    // villa-api mengabaikan unit_id untuk investor dan memakai sesi login,
    // jadi investor tanpa unit fisik (skema pemasukan tetap) tetap dimuat --
    // dulu halaman ini menunggu unitId selamanya dan spinner tak pernah hilang.
    api
      .get<Report>(`/report?unit_id=${unitId}&periode=${currentPeriod()}`)
      .then(setReport)
      // Tanpa catch, kegagalan jaringan tampil sebagai "Rp 0" -- terbaca
      // seolah villa tidak berpendapatan sama sekali.
      .catch((e: unknown) => setGalat(e instanceof Error ? e.message : "Gagal memuat data."))
      .finally(() => setLoading(false));
  }, [unitId]);

  return (
    <InvestorShell pageTitle="Rincian Opex" pageSub="Biaya operasional properti">
      <Card>
        <CardHeader title="Opex Bulan Ini" subtitle={periodLabel()} />
        <CardBody>
          {loading ? (
            <Loading />
          ) : galat ? (
            <div className="text-[11.5px] text-ruby-500">{galat}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-base-800 border border-ink/[0.08] rounded p-4">
                  <div className="text-[9px] text-ink/30 uppercase tracking-wide">Pendapatan Villa</div>
                  <div className="font-serif text-xl font-light text-ink mt-1">{fmtCurrency(pendapatanInvestor(report))}</div>
                </div>
                <div className="bg-gold-500/10 border border-gold-500/25 rounded p-4">
                  <div className="text-[9px] text-gold-500 uppercase tracking-wide">Opex Seluruh Villa</div>
                  <div className="font-serif text-xl font-light text-gold-500 mt-1">{fmtCurrency(report?.opex_per_unit)}</div>
                </div>
              </div>
              <div className="text-[11px] text-ink/30 leading-relaxed mt-5 bg-base-800 border-l-2 border-gold-500/40 rounded-r p-3.5">
                Opex properti tidak dihitung dari rincian biaya aktual bulanan, melainkan tetap sesuai kesepakatan (akad) yang
                berlaku — sehingga jumlahnya konsisten dan mudah diprediksi setiap bulan.
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </InvestorShell>
  );
}
