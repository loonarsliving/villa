"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { useChatUnreadPoll, useNotifPoll } from "@/lib/hooks";
import { usePropertiAktif } from "@/lib/properti";

export function FrontDeskShell({
  pageTitle,
  pageSub,
  topBarExtra,
  children,
}: {
  pageTitle: string;
  pageSub?: string;
  topBarExtra?: ReactNode;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const properti = usePropertiAktif(user);
  const pl = properti === "PL";
  const { unreadCount } = useNotifPoll("role=receptionist", "is_read_staff");
  // Chat WA satu nomor untuk semua properti; daftar disaring per properti di server.
  const { unreadCount: chatUnread } = useChatUnreadPoll(30000, !!user);

  // Properti selain PL (multi-properti 2026-11-04): hanya halaman yang
  // sudah diizinkan villa-api untuk properti lain. Kasir/QRIS, BBQ,
  // amenities, siteplan villa, dan chat masih khusus Private Living.
  const sectionsLain: NavSection[] = [
    {
      title: "Operasional",
      items: [
        { href: "/front-desk", label: "Front Desk", icon: "◈" },
        { href: "/front-desk/booking", label: "Booking", icon: "◎" },
        { href: "/front-desk/housekeeping", label: "Housekeeping", icon: "◉" },
        { href: "/front-desk/chat", label: "Chat", icon: "◉", badge: chatUnread },
        { href: "/front-desk/amenities", label: "Amenities", icon: "▧" },
        { href: "/front-desk/bbq", label: "Pesanan BBQ", icon: "🔥" },
      ],
    },
    { title: "Log", items: [{ href: "/front-desk/notifikasi", label: "Notifikasi", icon: "◉", badge: unreadCount }] },
    ...(user?.role === "admin"
      ? [{ title: "Admin", items: [{ href: "/pilih-properti", label: "Ganti Properti", icon: "⇄" }, { href: "/admin/excellent-living/harga", label: "Panel Admin", icon: "◈" }] }]
      : []),
  ];

  const sectionsPl: NavSection[] = [
    {
      title: "Operasional",
      items: [
        { href: "/front-desk", label: "Front Desk", icon: "◈" },
        { href: "/front-desk/siteplan", label: "Siteplan Villa", icon: "▤" },
        { href: "/front-desk/booking", label: "Kalender Booking", icon: "◎" },
        { href: "/front-desk/housekeeping", label: "Housekeeping", icon: "◉" },
        { href: "/front-desk/amenities", label: "Amenities", icon: "▧" },
        { href: "/front-desk/payment-gateway", label: "Payment Gateway", icon: "◍" },
        { href: "/front-desk/bbq", label: "Pesanan BBQ", icon: "🔥" },
        { href: "/front-desk/chat", label: "Chat", icon: "◉", badge: chatUnread },
      ],
    },
    {
      title: "Log",
      items: [{ href: "/front-desk/notifikasi", label: "Notifikasi", icon: "◉", badge: unreadCount }],
    },
  ];

  const sections = pl ? sectionsPl : sectionsLain;

  return (
    <DashboardShell
      property={pl ? undefined : properti === "EL" ? "Loonars Excellent Living" : properti}
      brandTitle="Panel"
      brandSub="Operasional"
      roleLabel="Resepsionis"
      sections={sections}
      pageTitle={pageTitle}
      pageSub={pageSub}
      topBarExtra={
        <>
          {topBarExtra}
          <Link href="/front-desk/notifikasi" className="relative w-8 h-8 bg-base-800 border border-ink/10 rounded flex items-center justify-center text-sm">
            🔔
            {unreadCount > 0 && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-ruby-500 rounded-full border border-base-800" />}
          </Link>
        </>
      }
    >
      {children}
    </DashboardShell>
  );
}
