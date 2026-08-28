"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { useNotifPoll } from "@/lib/hooks";

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
  const { unreadCount } = useNotifPoll("role=all", "is_read_staff");

  const sections: NavSection[] = [
    {
      title: "Operasional",
      items: [
        { href: "/front-desk", label: "Front Desk", icon: "◈" },
        { href: "/front-desk/siteplan", label: "Siteplan Villa", icon: "▤" },
        { href: "/front-desk/booking", label: "Kalender Booking", icon: "◎" },
        { href: "/front-desk/housekeeping", label: "Housekeeping", icon: "◉" },
        { href: "/front-desk/payment-gateway", label: "Payment Gateway", icon: "◍" },
      ],
    },
    {
      title: "Log",
      items: [{ href: "/front-desk/notifikasi", label: "Notifikasi", icon: "◉", badge: unreadCount }],
    },
  ];

  return (
    <DashboardShell
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
