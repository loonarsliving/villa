"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function FrontDeskLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["receptionist", "admin"]}>{children}</AuthProvider>;
}
