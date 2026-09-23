"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["finance", "admin"]}>{children}</AuthProvider>;
}
