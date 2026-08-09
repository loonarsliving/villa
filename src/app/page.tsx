"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { roleHome } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    const raw = localStorage.getItem("villa_user");
    const token = localStorage.getItem("villa_token");
    if (!raw || !token) {
      router.replace("/login");
      return;
    }
    const user = JSON.parse(raw) as SessionUser;
    router.replace(roleHome(user.role));
  }, [router]);
  return null;
}
