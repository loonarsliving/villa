"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["admin"]}>{children}</AuthProvider>;
}
