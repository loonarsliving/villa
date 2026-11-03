"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function PilihPropertiLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["admin", "finance"]}>{children}</AuthProvider>;
}
