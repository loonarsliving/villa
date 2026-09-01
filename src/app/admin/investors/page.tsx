"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import type { InvestorProfile } from "@/lib/types";

export default function AdminInvestorsPage() {
  const [rows, setRows] = useState<InvestorProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<InvestorProfile[]>("/admin/investors")
      .then((r) => setRows(r || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell pageTitle="Investor" pageSub="Profil investor yang sudah onboarding">
      <Card>
        <CardHeader title="Daftar Investor" subtitle={`${rows.length} profil`} />
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Loading label="Belum ada investor yang isi profil" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px] min-w-[500px]">
              <thead>
                <tr className="bg-base-800">
                  {["Nama", "Unit", "No. HP", "Rekening Dividen", "Terdaftar"].map((h) => (
                    <th key={h} className="text-left px-3.5 py-2 text-[8.5px] font-semibold tracking-wide uppercase text-ink/30 border-b border-ink/[0.08]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-base-800/50">
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] font-medium text-ink/80">{r.nama}</td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] text-gold-500">{r.unit_nomor}</td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] text-ink/70">{r.hp}</td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] text-ink/70">
                      {r.bank_nama && r.no_rekening ? (
                        `${r.bank_nama} ${r.no_rekening}${r.nama_pemilik_rekening ? ` a.n ${r.nama_pemilik_rekening}` : ""}`
                      ) : (
                        <span className="text-ruby-400/70">Belum diisi</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] text-ink/30 text-[10px]">
                      {fmtDate(r.created_at, { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
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
