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
      title: "Operasional",
      items: [{ href: "/front-desk/booking", label: "Kalender Booking", icon: "◎" }],
    },
    {
      title: "Kelola",
      items: [
        { href: "/admin/investors", label: "Investor", icon: "◎" },
        { href: "/admin/users", label: "Pengguna", icon: "◉" },
        { href: "/admin/staff", label: "Staff Operasional", icon: "▤" },
        { href: "/admin/amenities", label: "Amenities", icon: "▧" },
      ],
    },
    {
      title: "Kasir",
      items: [{ href: "/front-desk/payment-gateway", label: "Payment Gateway", icon: "◍" }],
    },
    {
      title: "Integrasi",
      items: [
        { href: "/admin/cloudbeds", label: "Cloudbeds", icon: "☁" },
        { href: "/admin/cctv", label: "CCTV", icon: "◍" },
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
