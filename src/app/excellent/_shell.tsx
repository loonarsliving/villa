"use client";

import type { ReactNode } from "react";
import { DashboardShell, type NavSection } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";

/** Shell Loonars Excellent Living -- resepsionis EL, investor EL, dan admin. */
export function ExcellentShell({ pageTitle, pageSub, children }: { pageTitle: string; pageSub?: string; children: ReactNode }) {
  const { user } = useAuth();
  const role = user?.role;

  const sections: NavSection[] = [];
  if (role === "el_receptionist" || role === "admin") {
    sections.push({
      title: "Front Desk",
      items: [
        { href: "/excellent/front-desk", label: "Status Kamar", icon: "◎" },
        { href: "/excellent/front-desk/booking", label: "Booking", icon: "▦" },
        { href: "/excellent/front-desk/housekeeping", label: "Housekeeping", icon: "✧" },
      ],
    });
  }
  if (role === "el_investor") {
    sections.push({ title: "Investor", items: [{ href: "/excellent/investor", label: "Unit Saya", icon: "◈" }] });
  }
  if (role === "admin") {
    sections.push({ title: "Admin", items: [{ href: "/admin", label: "Panel Admin", icon: "◈" }] });
  }

  const roleLabel = role === "admin" ? "Admin" : role === "el_investor" ? "Investor" : "Resepsionis";

  return (
    <DashboardShell
      property="Loonars Excellent Living"
      brandTitle="Panel"
      brandSub={role === "el_investor" ? "Investor" : "Front Desk"}
      roleLabel={roleLabel}
      sections={sections}
      pageTitle={pageTitle}
      pageSub={pageSub}
    >
      {children}
    </DashboardShell>
  );
}
