"use client";

import type { ReactNode } from "react";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";

export function FinanceShell({ pageTitle, pageSub, children }: { pageTitle: string; pageSub?: string; children: ReactNode }) {
  const { user } = useAuth();

  const sections: NavSection[] = [
    {
      title: "Finance",
      items: [
        { href: "/finance", label: "Ringkasan", icon: "◈" },
        { href: "/finance/settlement-config", label: "Konfigurasi Settlement OTA", icon: "☰" },
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
