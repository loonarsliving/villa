"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, localApi } from "./api";
import type { Notification, WaConversationRow } from "./types";
import { useToast } from "./toast";
import { bacaDilihat, totalBaruDiPerangkat } from "./chatPerangkat";

export function useNotifPoll(query: string, readField: "is_read_owner" | "is_read_staff" | "is_read_admin") {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const toast = useToast();
  const seen = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Notification[]>(`/notifications?${query}`);
      const list = data || [];
      setNotifications(list);
      const unread = list.filter((n) => !n[readField]);
      if (unread[0] && !seen.current.has(unread[0].id)) {
        seen.current.add(unread[0].id);
        if (seen.current.size > 1) toast("🔔", unread[0].judul, unread[0].pesan, "gold");
      }
    } catch {
      // ignore transient poll errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const unreadCount = notifications.filter((n) => !n[readField]).length;
  return { notifications, unreadCount, refresh };
}

/**
 * Jumlah pesan WhatsApp belum dibalas yang belum dilihat DI PERANGKAT INI
 * (src/lib/chatPerangkat.ts, 2026-11-12), untuk lencana di navigasi
 * (FrontDeskShell / AdminShell) -- dipoling terpisah dari notifikasi
 * in-app karena sumbernya beda tabel (wa_conversations, bukan
 * notifications). Gagal poll diam-diam saja: lencana nav bukan tempat
 * yang tepat untuk menumpuk toast galat jaringan.
 */
export function useChatUnreadPoll(intervalMs = 30000, aktif = true) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!aktif) return;
    let cancelled = false;
    let terakhir: WaConversationRow[] = [];
    const refresh = () => {
      localApi<WaConversationRow[]>("/api/chat/conversations")
        .then((rows) => {
          terakhir = rows || [];
          if (!cancelled) setUnreadCount(totalBaruDiPerangkat(terakhir, bacaDilihat()));
        })
        .catch(() => {});
    };
    // Percakapan dibuka di halaman Chat -> lencana di perangkat ini langsung turun.
    const onDilihat = () => {
      if (!cancelled) setUnreadCount(totalBaruDiPerangkat(terakhir, bacaDilihat()));
    };
    refresh();
    const id = setInterval(refresh, intervalMs);
    window.addEventListener("villa-chat-dilihat", onDilihat);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("villa-chat-dilihat", onDilihat);
    };
  }, [intervalMs, aktif]);

  return { unreadCount };
}
