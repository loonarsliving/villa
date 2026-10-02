"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function ManagerLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["manager", "admin"]}>{children}</AuthProvider>;
}
