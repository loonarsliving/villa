"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function ExcellentInvestorLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["el_investor"]}>{children}</AuthProvider>;
}
