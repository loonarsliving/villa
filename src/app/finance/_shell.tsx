"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function FinanceShell({ pageTitle, pageSub, children }: { pageTitle: string; pageSub?: string; children: ReactNode }) {
  const { user } = useAuth();
  // Finance tidak ada di chat pengajuan (keputusan owner 2026-10-26), jadi
  // pengajuan baru dari manager ditandai angka di menu ini.
  const [pengajuanMenunggu, setPengajuanMenunggu] = useState(0);
  useEffect(() => {
    api
      .get<{ menunggu: number }>("/finance/pengajuan/menunggu")
      .then((d) => setPengajuanMenunggu(d.menunggu))
      .catch(() => {});
  }, []);

  const sections: NavSection[] = [
    {
      title: "Finance",
      items: [
        { href: "/finance", label: "Ringkasan", icon: "◈" },
        { href: "/finance/rencana-kas", label: "Rencana Kas", icon: "◎" },
        { href: "/finance/laba-rugi", label: "Laba Rugi & COGS", icon: "▤" },
        { href: "/finance/pendapatan", label: "Pendapatan & Channel", icon: "↗" },
        { href: "/finance/transaksi", label: "Transaksi", icon: "☷" },
        { href: "/finance/pengajuan-biaya", label: "Pengajuan Biaya", icon: "₨", badge: pengajuanMenunggu },
      ],
    },
    {
      title: "Excellent Living",
      items: [{ href: "/finance/excellent-living", label: "Keuangan Excellent Living", icon: "↗" }],
    },
    {
      title: "Alat",
      items: [
        { href: "/finance/checklist-dana", label: "Checklist Dana Masuk", icon: "✓" },
        { href: "/finance/scenario", label: "What-If / Skenario", icon: "◆" },
        { href: "/finance/referral", label: "Fee Referral", icon: "%" },
      ],
    },
    {
      title: "Pengaturan",
      items: [
        { href: "/finance/settlement-config", label: "Konfigurasi Settlement OTA", icon: "☰" },
        { href: "/finance/property-config", label: "Konfigurasi Properti", icon: "⚙" },
      ],
    },
  ];

  return (
    <DashboardShell
      brandTitle="Panel"
      brandSub="Finance"
      roleLabel={user?.role === "admin" ? "Admin" : "Finance"}
      sections={sections}
      pageTitle={pageTitle}
      pageSub={pageSub}
    >
      {children}
    </DashboardShell>
  );
}
