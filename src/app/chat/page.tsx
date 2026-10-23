"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { tujuanChat } from "@/lib/chatRoute";
import type { SessionUser } from "@/lib/types";

/**
 * Alamat pendek living.haluoleo.id/chat (owner 2026-10-23, padanan
 * mkh.haluoleo.id/refund/chat). Mengarahkan ke halaman Chat sesuai peran yang
 * login, membawa ?c=<id percakapan> supaya tautan langsung tetap membuka chat
 * yang tepat. Halaman tujuan tetap yang menegakkan akses (villa-api + /api/chat/*).
 */
export default function ChatShortcut() {
  const router = useRouter();
  useEffect(() => {
    const raw = localStorage.getItem("villa_user");
    const token = localStorage.getItem("villa_token");
    if (!raw || !token) {
      router.replace("/login");
      return;
    }
    let role: string | undefined;
    try {
      role = (JSON.parse(raw) as SessionUser).role;
    } catch {
      router.replace("/login");
      return;
    }
    const tujuan = tujuanChat(role);
    router.replace(tujuan ? `${tujuan}${window.location.search}` : "/");
  }, [router]);
  return null;
}
