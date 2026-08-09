"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function InvestorLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["owner"]}>{children}</AuthProvider>;
}
