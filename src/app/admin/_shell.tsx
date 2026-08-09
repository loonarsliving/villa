"use client";

import type { ReactNode } from "react";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";

export function AdminShell({ pageTitle, pageSub, children }: { pageTitle: string; pageSub?: string; children: ReactNode }) {
  const { user } = useAuth();

  const sections: NavSection[] = [
    {
      title: "Ikhtisar",
      items: [{ href: "/admin", label: "Overview", icon: "◈" }],
    },
    {
      title: "Kelola",
      items: [
        { href: "/admin/investors", label: "Investor", icon: "◎" },
        { href: "/admin/users", label: "Pengguna", icon: "◉" },
        { href: "/admin/staff", label: "Staff Operasional", icon: "▤" },
      ],
    },
    {
      title: "Integrasi",
      items: [
        { href: "/admin/cloudbeds", label: "Cloudbeds", icon: "☁" },
        { href: "/admin/settings", label: "Pengaturan Integrasi", icon: "⚙" },
        { href: "/admin/wa-log", label: "Log WhatsApp", icon: "◉" },
      ],
    },
  ];

  return (
    <DashboardShell
      brandTitle="Panel"
      brandSub="Admin"
      roleLabel={user?.nama ? "Business Owner" : "Admin"}
      sections={sections}
      pageTitle={pageTitle}
      pageSub={pageSub}
    >
      {children}
    </DashboardShell>
  );
}
