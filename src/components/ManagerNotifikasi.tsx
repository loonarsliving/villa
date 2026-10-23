"use client";

import { useEffect, useRef, useState } from "react";
import { localApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { VILLA_VAPID_PUBLIC_KEY } from "@/lib/webPushConfig";

/**
 * Notifikasi chat tamu untuk manager / Rebecca (owner 2026-10-23: "seperti
 * chat refund di Mkhsistem"). Dipasang di ManagerShell, hanya untuk role
 * manager.
 *
 * - Push HP: mendaftarkan service worker (/sw.js) dan langganan Web Push ke
 *   /api/push/subscribe. iPhone mewajibkan izin diminta lewat ketukan,
 *   jadi tombol "Aktifkan notifikasi" tampil sampai izin diberikan; di
 *   iPhone yang membuka lewat Safari biasa (bukan ikon layar utama) push
 *   tidak tersedia, jadi yang tampil petunjuk "Tambahkan ke Layar Utama".
 * - Saat aplikasi terbuka: bunyi "ding" + toast saat jumlah belum-dibaca
 *   naik, judul tab diberi penanda saat tab di belakang, dan angka di ikon
 *   aplikasi (setAppBadge) disamakan dengan jumlah belum-dibaca.
 */

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
type Status = "memeriksa" | "aktif" | "perlu-izin" | "ditolak" | "pasang-dulu" | "tidak-didukung";

function base64UrlKeKunci(base64Url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

function iPhoneDiSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

function bunyiDing() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const mulai = now + i * 0.14;
      gain.gain.setValueAtTime(0.0001, mulai);
      gain.gain.exponentialRampToValueAtTime(0.25, mulai + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, mulai + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(mulai);
      osc.stop(mulai + 0.26);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // audio tidak tersedia -- toast dan push tetap jalan
  }
}

async function kirimLangganan(): Promise<boolean> {
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlKeKunci(VILLA_VAPID_PUBLIC_KEY) }));
  const hasil = await localApi<{ aktif?: boolean }>("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
  return hasil?.aktif === true;
}

export function ManagerNotifikasi({ unread }: { unread: number }) {
  const toast = useToast();
  const [status, setStatus] = useState<Status>("memeriksa");
  const sebelumnya = useRef<number | null>(null);
  const judulAsli = useRef<string | null>(null);

  // Pendaftaran service worker + langganan push.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setStatus("tidak-didukung");
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (!("PushManager" in window) || !("Notification" in window)) {
      setStatus(iPhoneDiSafari() ? "pasang-dulu" : "tidak-didukung");
      return;
    }
    if (Notification.permission === "granted") {
      // Diperbarui tiap buka aplikasi: langganan bisa berganti / terhapus server.
      kirimLangganan()
        .then((aktif) => setStatus(aktif ? "aktif" : "tidak-didukung"))
        .catch(() => setStatus("perlu-izin"));
    } else {
      setStatus(Notification.permission === "denied" ? "ditolak" : "perlu-izin");
    }
  }, []);

  async function aktifkan() {
    try {
      const izin = await Notification.requestPermission();
      if (izin !== "granted") {
        setStatus(izin === "denied" ? "ditolak" : "perlu-izin");
        return;
      }
      const aktif = await kirimLangganan();
      setStatus(aktif ? "aktif" : "tidak-didukung");
      if (aktif) toast("🔔", "Notifikasi aktif", "Chat tamu baru akan muncul di HP ini.", "sage");
    } catch {
      toast("⚠", "Gagal mengaktifkan", "Coba lagi sebentar lagi.", "ruby");
    }
  }

  // Bunyi + toast + judul tab + angka ikon mengikuti jumlah belum-dibaca.
  useEffect(() => {
    const nav = navigator as BadgeNavigator;
    if (typeof nav.setAppBadge === "function") {
      (unread > 0 ? nav.setAppBadge(unread) : (nav.clearAppBadge?.() ?? Promise.resolve())).catch(() => {});
    }

    const lama = sebelumnya.current;
    sebelumnya.current = unread;
    if (lama === null || unread <= lama) return;

    bunyiDing();
    toast("💬", "Chat tamu baru", `${unread} pesan belum dibaca — buka menu Chat.`, "azure");
    if (document.visibilityState !== "visible") {
      if (judulAsli.current === null) judulAsli.current = document.title;
      document.title = `(${unread}) 💬 Chat tamu baru`;
    }
  }, [unread, toast]);

  useEffect(() => {
    const kembali = () => {
      if (document.visibilityState === "visible" && judulAsli.current !== null) {
        document.title = judulAsli.current;
        judulAsli.current = null;
      }
    };
    document.addEventListener("visibilitychange", kembali);
    return () => document.removeEventListener("visibilitychange", kembali);
  }, []);

  if (status === "perlu-izin") {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sage-500/30 bg-sage-500/10 px-4 py-3 text-sm">
        <span>🔔 Aktifkan notifikasi supaya chat tamu baru langsung muncul di HP ini.</span>
        <button type="button" onClick={aktifkan} className="rounded-full bg-sage-600 px-4 py-1.5 text-sm font-medium text-white">
          Aktifkan notifikasi
        </button>
      </div>
    );
  }
  if (status === "pasang-dulu") {
    return (
      <div className="mb-4 rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-3 text-sm">
        📲 Untuk notifikasi chat tamu di iPhone: ketuk tombol <b>Bagikan</b> di Safari → <b>Tambahkan ke Layar Utama</b>, lalu buka aplikasi dari ikon
        tersebut.
      </div>
    );
  }
  if (status === "ditolak") {
    return (
      <div className="mb-4 rounded-xl border border-ruby-500/30 bg-ruby-500/10 px-4 py-3 text-sm">
        🔕 Notifikasi diblokir di perangkat ini. Aktifkan lewat Pengaturan → Notifikasi → Loonars Living.
      </div>
    );
  }
  return null;
}
