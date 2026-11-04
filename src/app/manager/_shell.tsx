"use client";

import type { ReactNode } from "react";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { useChatUnreadPoll } from "@/lib/hooks";
import { ManagerNotifikasi } from "@/components/ManagerNotifikasi";

export function ManagerShell({ pageTitle, pageSub, children }: { pageTitle: string; pageSub?: string; children: ReactNode }) {
  const { user } = useAuth();
  // Lebih sering dari 30 detik bawaan: angka ini juga memicu bunyi/toast chat tamu baru (2026-10-23).
  // Manager Excellent Living tidak memakai chat Private Living: polling dimatikan
  // (endpoint chat menolaknya, dan 401 akan mengeluarkan sesi).
  const { unreadCount: chatUnread } = useChatUnreadPoll(15000, !!user && user.property_kode !== "EL");

  // Manager properti selain Private Living (owner 2026-11-04: login manager
  // per properti) hanya melihat menu properti itu; modul manager lain di
  // bawah masih khusus Private Living dan dikunci di villa-api.
  const propertiLain = user?.property_kode === "EL";
  const sections: NavSection[] = propertiLain
    ? [
        {
          title: "Manager Excellent Living",
          items: [
            { href: "/manager", label: "Kesiapan Kamar", icon: "✓" },
            { href: "/manager/riwayat", label: "Riwayat Cek", icon: "☰" },
            { href: "/manager/kamar-el", label: "Kamar Excellent Living", icon: "▦" },
          ],
        },
      ]
    : [
    {
      title: "Manager",
      items: [
        { href: "/manager", label: "Kesiapan Kamar", icon: "✓" },
        { href: "/manager/riwayat", label: "Riwayat Cek", icon: "☰" },
        { href: "/manager/kamar-el", label: "Kamar Excellent Living", icon: "▦" },
        { href: "/manager/pengajuan", label: "Pengajuan Biaya", icon: "₨" },
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
      property={propertiLain ? "Loonars Excellent Living" : undefined}
      brandTitle="Panel"
      brandSub="Manager"
      roleLabel={user?.role === "admin" ? "Admin" : "Manager"}
      sections={sections}
      pageTitle={pageTitle}
      pageSub={pageSub}
    >
      {user?.role === "manager" && user.property_kode !== "EL" && <ManagerNotifikasi unread={chatUnread} />}
      {children}
    </DashboardShell>
  );
}
