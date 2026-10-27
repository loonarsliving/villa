"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

export default function ExcellentFrontDeskLayout({ children }: { children: ReactNode }) {
  return <AuthProvider requireRole={["el_receptionist", "admin"]}>{children}</AuthProvider>;
}
