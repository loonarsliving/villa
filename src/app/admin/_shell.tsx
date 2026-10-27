"use client";

import type { ReactNode } from "react";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { useChatUnreadPoll } from "@/lib/hooks";

export function AdminShell({ pageTitle, pageSub, children }: { pageTitle: string; pageSub?: string; children: ReactNode }) {
  const { user } = useAuth();
  const { unreadCount: chatUnread } = useChatUnreadPoll();

  const sections: NavSection[] = [
    {
      title: "Ikhtisar",
      items: [
        { href: "/admin", label: "Overview", icon: "◈" },
        { href: "/admin/revenue", label: "Revenue", icon: "◇" },
        { href: "/admin/pricing-calendar", label: "Kalender Harga", icon: "▦" },
        { href: "/admin/pricing-recommendations", label: "Rekomendasi Harga", icon: "◆" },
        { href: "/admin/pricing-competitor", label: "High Season & Kompetitor", icon: "✦" },
        { href: "/admin/occupancy-forecast", label: "Perkiraan Okupansi", icon: "◒" },
      ],
    },
    {
      title: "Operasional",
      items: [
        { href: "/front-desk/booking", label: "Kalender Booking", icon: "◎" },
        { href: "/manager", label: "Kesiapan Kamar", icon: "✓" },
        { href: "/front-desk/chat", label: "Chat", icon: "◉", badge: chatUnread },
      ],
    },
    {
      title: "Pemasaran",
      items: [
        { href: "/admin/guests", label: "Database Tamu", icon: "◈" },
        { href: "/admin/promos", label: "Promo", icon: "◆" },
      ],
    },
    {
      title: "Kelola",
      items: [
        { href: "/admin/investors", label: "Investor", icon: "◎" },
        { href: "/admin/bukti-transfer", label: "Bukti Transfer Dividen", icon: "✓" },
        { href: "/admin/users", label: "Pengguna", icon: "◉" },
        { href: "/admin/staff", label: "Staff Operasional", icon: "▤" },
        { href: "/admin/amenities", label: "Amenities", icon: "▧" },
      ],
    },
    {
      title: "Excellent Living",
      items: [
        { href: "/excellent/front-desk", label: "Kamar & Booking EL", icon: "◎" },
        { href: "/admin/excellent-living/kamar", label: "Atur Kamar EL", icon: "▦" },
        { href: "/admin/excellent-living/investor", label: "Investor EL", icon: "◈" },
        { href: "/admin/excellent-living/cloudbeds", label: "Cloudbeds EL", icon: "☁" },
        { href: "/finance/excellent-living", label: "Keuangan EL", icon: "↗" },
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
