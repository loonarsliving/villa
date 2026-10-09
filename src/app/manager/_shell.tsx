"use client";

import type { ReactNode } from "react";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { useChatUnreadPoll } from "@/lib/hooks";

export function ManagerShell({ pageTitle, pageSub, children }: { pageTitle: string; pageSub?: string; children: ReactNode }) {
  const { user } = useAuth();
  const { unreadCount: chatUnread } = useChatUnreadPoll();

  const sections: NavSection[] = [
    {
      title: "Manager",
      items: [
        { href: "/manager", label: "Kesiapan Kamar", icon: "✓" },
        { href: "/manager/riwayat", label: "Riwayat Cek", icon: "☰" },
        { href: "/manager/chat", label: "Chat", icon: "◉", badge: chatUnread },
        { href: "/manager/cctv", label: "CCTV", icon: "◍" },
      ],
    },
  ];
  // Admin juga boleh membuka modul ini; beri jalan pulang ke panelnya.
  if (user?.role === "admin") {
    sections.push({ title: "Admin", items: [{ href: "/admin", label: "Panel Admin", icon: "◈" }] });
  }

  return (
    <DashboardShell
      brandTitle="Panel"
      brandSub="Manager"
      roleLabel={user?.role === "admin" ? "Admin" : "Manager"}
      sections={sections}
      pageTitle={pageTitle}
      pageSub={pageSub}
    >
      {children}
    </DashboardShell>
  );
}
