import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { VILLA_VAPID_PUBLIC_KEY } from "./webPushConfig";

/**
 * Pengirim Web Push aplikasi villa (tabel `villa_push_subscriptions`,
 * migrasi 20261023000001). Isi notifikasi dibaca oleh public/sw.js.
 *
 * Seperti pengiriman WA di codebase ini, TIDAK PERNAH melempar ke
 * pemanggilnya: notifikasi yang gagal tidak boleh menggagalkan pencatatan
 * chat tamu. Langganan yang sudah mati (404/410 dari layanan push) dihapus.
 */
export interface IsiPush {
  title: string;
  body: string;
  /** Halaman yang dibuka saat notifikasi diketuk. */
  link: string;
  /** Angka di ikon aplikasi (iPhone layar utama / PWA). 0 = hapus angka. */
  badge?: number;
  /** Notifikasi dengan tag sama saling menggantikan (satu per percakapan). */
  tag?: string;
}

let vapidSiap: boolean | null = null;

function siapkanVapid(): boolean {
  if (vapidSiap !== null) return vapidSiap;
  const privateKey = (process.env.VILLA_VAPID_PRIVATE_KEY ?? "").trim();
  if (!privateKey) {
    console.error("[webPush] VILLA_VAPID_PRIVATE_KEY belum dikonfigurasi -- notifikasi push tidak dikirim");
    vapidSiap = false;
    return false;
  }
  webpush.setVapidDetails("mailto:admin@haluoleo.id", VILLA_VAPID_PUBLIC_KEY, privateKey);
  vapidSiap = true;
  return true;
}

export async function kirimPushKePeranAman(supabase: SupabaseClient, role: string, isi: IsiPush): Promise<{ terkirim: number }> {
  try {
    if (!siapkanVapid()) return { terkirim: 0 };

    const { data: langganan, error } = await supabase
      .from("villa_push_subscriptions")
      .select("id,endpoint,p256dh,auth_key")
      .eq("role", role);
    if (error) {
      console.error("[webPush] gagal membaca langganan", error.message);
      return { terkirim: 0 };
    }
    if (!langganan?.length) return { terkirim: 0 };

    const payload = JSON.stringify({ ...isi, timestamp: Date.now() });
    const mati: string[] = [];
    let terkirim = 0;

    await Promise.all(
      langganan.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload, { TTL: 60 * 60 });
          terkirim += 1;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) mati.push(s.id);
          else console.error("[webPush] kirim gagal", status ?? "", e instanceof Error ? e.message : String(e));
        }
      }),
    );

    if (mati.length) await supabase.from("villa_push_subscriptions").delete().in("id", mati);
    return { terkirim };
  } catch (e) {
    console.error("[webPush] galat tak terduga", e instanceof Error ? e.message : String(e));
    return { terkirim: 0 };
  }
}

/** Jumlah pesan tamu yang belum dibaca di seluruh kotak masuk -- angka di ikon aplikasi. */
export async function totalChatBelumDibaca(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("wa_conversations").select("unread_count").gt("unread_count", 0);
  return (data ?? []).reduce((s, r) => s + ((r as { unread_count: number }).unread_count ?? 0), 0);
}

/** Teks notifikasi chat tamu: judul "Pesan dari …", isi pesannya (dipotong). Murni, diuji di webPush.test.ts. */
export function isiNotifChatTamu(input: { nama: string | null | undefined; phone: string; text: string; adaMedia: boolean }): { title: string; body: string } {
  const nama = (input.nama ?? "").trim() || input.phone;
  const teks = input.text.trim();
  const body = teks ? (teks.length > 180 ? `${teks.slice(0, 177)}...` : teks) : input.adaMedia ? "📷 Foto / file" : "Pesan baru";
  return { title: `Pesan dari ${nama}`, body };
}
