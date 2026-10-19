"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmtCurrency, currentPeriod, periodLabel } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading } from "@/components/Card";
import { pendapatanInvestor } from "@/lib/investorPendapatan";
import { RincianBiayaInvestor } from "@/components/RincianBiayaInvestor";
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
    <InvestorShell pageTitle="Rincian Biaya" pageSub="COGS dan OPEX properti">
      <Card>
        <CardHeader title="Biaya Bulan Ini" subtitle={periodLabel()} />
        <CardBody>
          {loading ? (
            <Loading />
          ) : galat ? (
            <div className="text-[11.5px] text-ruby-500">{galat}</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-base-800 border border-ink/[0.08] rounded p-4">
                  <div className="text-[9px] text-ink/30 uppercase tracking-wide">Pendapatan Villa</div>
                  <div className="font-serif text-xl font-light text-ink mt-1">{fmtCurrency(pendapatanInvestor(report))}</div>
                </div>
                <div className="bg-gold-500/10 border border-gold-500/25 rounded p-4">
                  <div className="text-[9px] text-gold-500 uppercase tracking-wide">COGS</div>
                  <div className="font-serif text-xl font-light text-gold-500 mt-1">{fmtCurrency(report?.cogs)}</div>
                </div>
                <div className="bg-gold-500/10 border border-gold-500/25 rounded p-4">
                  <div className="text-[9px] text-gold-500 uppercase tracking-wide">OPEX</div>
                  <div className="font-serif text-xl font-light text-gold-500 mt-1">{fmtCurrency(report?.opex ?? report?.opex_per_unit)}</div>
                </div>
              </div>
              <div className="text-[11px] text-ink/40 leading-relaxed mt-5 bg-base-800 border-l-2 border-gold-500/40 rounded-r p-3.5">
                COGS adalah biaya untuk setiap kamar yang terisi (listrik kamar, laundry, amenities, ditambah bagian internet,
                listrik receptionist, dan Cloudbeds). OPEX adalah gaji staf. Pendapatan dikurangi COGS dan OPEX menjadi Net
                Profit yang dibagi 70% investor dan 30% Loonars.
              </div>
            </>
          )}
        </CardBody>
      </Card>
      {report && !galat && <RincianBiayaInvestor report={report} />}
    </InvestorShell>
  );
}
