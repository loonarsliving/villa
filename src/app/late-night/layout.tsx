"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function LateNightLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["late_night", "admin"]}>{children}</AuthProvider>;
}
