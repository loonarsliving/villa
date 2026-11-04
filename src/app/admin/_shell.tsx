"use client";

import type { ReactNode } from "react";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { useChatUnreadPoll } from "@/lib/hooks";
import { usePropertiTerpilih } from "@/lib/properti";

export function AdminShell({ pageTitle, pageSub, children }: { pageTitle: string; pageSub?: string; children: ReactNode }) {
  const { user } = useAuth();
  const { unreadCount: chatUnread } = useChatUnreadPoll();
  const properti = usePropertiTerpilih();

  const semua: NavSection[] = [
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
        { href: "/admin/staff", label: "Staff Operasional", icon: "▤" },
        { href: "/admin/amenities", label: "Amenities", icon: "▧" },
      ],
    },
    {
      // Excellent Living memakai halaman Private Living dengan data EL
      // (multi-properti 2026-11-04). Hanya halaman yang diizinkan villa-api.
      title: "Excellent Living",
      items: [
        { href: "/front-desk", label: "Front Desk", icon: "◈" },
        { href: "/front-desk/booking", label: "Booking", icon: "◎" },
        { href: "/front-desk/housekeeping", label: "Housekeeping", icon: "◉" },
        { href: "/manager/kamar-el", label: "Buka/Tutup Kamar", icon: "▦" },
        { href: "/admin/excellent-living/harga", label: "Harga (Cloudbeds)", icon: "₨" },
        { href: "/admin/excellent-living/cloudbeds", label: "Cloudbeds", icon: "☁" },
        { href: "/finance/pendapatan", label: "Pendapatan & Channel", icon: "↗" },
        { href: "/finance/checklist-dana", label: "Checklist Dana Masuk", icon: "✓" },
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

  // Menu mengikuti properti yang dipilih (owner 2026-11-04). Private Living =
  // semua menu lama; Excellent Living = menu EL; properti baru = belum ada
  // fitur operasional. Pengelolaan properti & pengguna selalu tampil.
  const propertiNav: NavSection = {
    title: "Properti",
    items: [
      { href: "/pilih-properti", label: "Ganti Properti", icon: "⇄" },
      { href: "/admin/properti", label: "Kelola Properti", icon: "⌂" },
      { href: "/admin/users", label: "Pengguna & Role", icon: "◉" },
    ],
  };
  const sections: NavSection[] =
    properti.kode === "PL"
      ? [propertiNav, ...semua.filter((s) => s.title !== "Excellent Living")]
      : properti.kode === "EL"
        ? [propertiNav, ...semua.filter((s) => s.title === "Excellent Living")]
        : [propertiNav];

  return (
    <DashboardShell
      property={properti.nama}
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
