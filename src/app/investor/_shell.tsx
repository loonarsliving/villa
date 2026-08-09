"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { useNotifPoll } from "@/lib/hooks";

export function InvestorShell({
  pageTitle,
  pageSub,
  children,
}: {
  pageTitle: string;
  pageSub?: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const unitId = user?.unit_id || "";
  const { unreadCount } = useNotifPoll(`unit_id=${unitId}&role=owner`, "is_read_owner");

  const sections: NavSection[] = [
    {
      title: "Ikhtisar",
      items: [
        { href: "/investor", label: "Beranda", icon: "◈" },
        { href: "/investor/pendapatan", label: "Pendapatan", icon: "◎" },
      ],
    },
    {
      title: "Laporan",
      items: [
        { href: "/investor/laporan", label: "Laporan Bulanan", icon: "▤" },
        { href: "/investor/opex", label: "Rincian Opex", icon: "▤" },
      ],
    },
    {
      title: "Lainnya",
      items: [{ href: "/investor/notifikasi", label: "Notifikasi", icon: "◉", badge: unreadCount }],
    },
  ];

  return (
    <DashboardShell
      brandTitle="Dashboard"
      brandSub="Investor"
      roleLabel={`Pemilik Unit ${user?.unit_nomor || ""}`}
      sections={sections}
      pageTitle={pageTitle}
      pageSub={pageSub}
      topBarExtra={
        <Link href="/investor/notifikasi" className="relative w-8 h-8 bg-base-800 border border-white/10 rounded flex items-center justify-center text-sm">
          🔔
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-ruby-500 rounded-full border border-base-800" />
          )}
        </Link>
      }
    >
      {children}
    </DashboardShell>
  );
}
