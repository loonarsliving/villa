import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Peringatan kamar yang GENTING juga dikirim lewat WhatsApp, bukan hanya
 * notifikasi di aplikasi.
 *
 * Owner 10 Nov 2026: "Jgan pernah biarkan ini terulang lagi". Peringatan
 * "TIDAK MASUK SISTEM" untuk el nasution tercatat 03.20 WITA, tamunya
 * check-in hari itu, dan tidak ada yang membacanya -- notifikasi aplikasi
 * hanya terlihat oleh yang sedang membuka aplikasi.
 *
 * Penerima: owner (integration_settings.villa_notify.owner_hp), manager dan
 * resepsionis aktif (villa_users) -- penerima yang sama dengan peringatan
 * booking OTA di webhook Cloudbeds. Jalur kirim sama persis dengan villa-api
 * sendWa() (integration_settings.vercel_bridge -> /api/wa/send, dicatat di
 * wa_messages_log). Sekali per judul: pemanggil hanya memanggil ini saat
 * notifikasinya BARU dibuat.
 */

const AWALAN_GENTING = [
  "TIDAK MASUK SISTEM",
  "PERLU PINDAH KAMAR",
  "Kamar Cloudbeds belum sama",
  "Booking dipindah ke Unit",
];

export function judulGenting(judul: string): boolean {
  return AWALAN_GENTING.some((a) => judul.startsWith(a));
}

function normalHp(hp: string | null | undefined): string | null {
  const d = String(hp ?? "").replace(/\D/g, "");
  if (d.length < 9) return null;
  return d.startsWith("0") ? `62${d.slice(1)}` : d;
}

export async function kirimPeringatanKamarWa(supabase: SupabaseClient, judul: string, pesan: string): Promise<void> {
  const { data: setting } = await supabase.from("integration_settings").select("value").eq("key", "vercel_bridge").maybeSingle();
  const bridge = (setting?.value as { base_url?: string; secret?: string } | null) ?? {};
  const { data: notify } = await supabase.from("integration_settings").select("value").eq("key", "villa_notify").maybeSingle();
  const ownerHp = (notify?.value as { owner_hp?: string } | null)?.owner_hp ?? null;
  const { data: staf } = await supabase.from("villa_users").select("hp, nama, role").in("role", ["manager", "receptionist"]).eq("is_active", true);

  const penerima = new Map<string, string>();
  const o = normalHp(ownerHp);
  if (o) penerima.set(o, "owner");
  for (const s of (staf as { hp: string | null; nama: string; role: string }[] | null) ?? []) {
    const h = normalHp(s.hp);
    if (h && !penerima.has(h)) penerima.set(h, s.role);
  }

  const message = `⚠️ ${judul}\n\n${pesan}`;
  const meta = { template_type: "cloudbeds_peringatan_kamar" };
  for (const [phone] of penerima) {
    if (!bridge.base_url || !bridge.secret) {
      await supabase.from("wa_messages_log").insert({ ...meta, phone, message, status: "skipped_not_configured" });
      continue;
    }
    try {
      const r = await fetch(`${bridge.base_url.replace(/\/+$/, "")}/api/wa/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": bridge.secret },
        body: JSON.stringify({ phone, message }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const result = await r.json().catch(() => null);
      await supabase.from("wa_messages_log").insert({
        ...meta,
        phone,
        message,
        status: r.ok && result?.success ? "sent" : "failed",
        response: result ?? { http_status: r.status },
      });
    } catch (e) {
      await supabase.from("wa_messages_log").insert({ ...meta, phone, message, status: "error", response: { error: String(e) } });
    }
  }
}
