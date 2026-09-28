import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { todayISO, WIB_TIME_ZONE } from "./format";
import { kirimDariNomorUtama } from "./mkhsistemWa";
import { cariAtauBuatPercakapan, catatPesan } from "./waChat";
import { bahasaDariNomor, rapikanNama, teksSambutan, type BahasaSambutan } from "./otaWelcomeText";

/**
 * Sambutan WhatsApp otomatis untuk tamu yang booking lewat OTA yang benar-benar
 * tersambung ke Cloudbeds villa (owner 2026-09-28, diperluas 2026-09-28 malam:
 * "biarkan lebih banyak ota... cloudbedsku banyak koneksinya"). Dijalankan
 * setelah setiap sinkron reservasi Cloudbeds (tiap 10 menit, pg_cron job 105).
 *
 * SUMBER sengaja TIDAK memakai semua nilai yang diizinkan bookings.sumber:
 * - 'google' dikeluarkan -- itu klik metasearch, tamunya tetap membayar lewat
 *   kanal lain (lihat mapSourceNameToSumber), jadi "booking Kakak melalui
 *   Google" tidak masuk akal dan bisa dobel dengan sambutan dari kanal
 *   pembayaran aslinya.
 * - 'cloudbeds' dikeluarkan -- itu keranjang bawaan untuk sourceName yang TIDAK
 *   dikenali (lihat cloudbedsSourceMapping.ts), bukan satu platform tertentu.
 *   Mengirim sambutan OTA ke situ berisiko salah nama platform.
 * - 'website'/'walk-in'/'whatsapp'/'other' dikeluarkan -- bukan OTA; tamu jalur
 *   itu sudah punya kontak langsung dengan villa.
 * Kalau owner menyambungkan OTA baru di Cloudbeds yang sourceName-nya belum
 * dikenali mapSourceNameToSumber, tambahkan dulu di sana (sumber sungguhan,
 * bukan 'cloudbeds'), baru daftarkan namanya di PLATFORM (otaWelcomeText.ts)
 * dan tambahkan ke SUMBER di sini.
 *
 * Aturan lain (tidak berubah):
 * - hanya booking yang MASUK ke villa setelah fitur ini aktif (SAMBUTAN_MULAI)
 *   dan dalam 3 hari terakhir -- tamu lama tidak tiba-tiba dikirimi pesan;
 * - hanya booking terjadwal yang tanggal check-in-nya belum lewat;
 * - hanya 08.00-21.00 WIB; di luar itu ditunda ke sinkron berikutnya;
 * - satu kali per booking, dijaga lewat wa_messages_log (lihat klaim()).
 *
 * Dikirim dari 0822 lewat Mkhsistem dan dicatat di Chat resepsionis, jadi
 * balasan tamu langsung masuk ke sana.
 */

export const SAMBUTAN_MULAI = "2026-09-28T00:00:00+07:00";
const TEMPLATE = "ota_welcome";
/** Diuji langsung di otaWelcome.test.ts -- termasuk memastikan 'google' dan 'cloudbeds' TIDAK ikut. */
export const SUMBER_OTA_DISAMBUT = ["agoda", "airbnb", "booking.com", "traveloka", "tiket"] as const;
const SUMBER = SUMBER_OTA_DISAMBUT;
const MAKS_PER_JALAN = 5;

export function dalamJamKirim(now: Date = new Date()): boolean {
  const jam = Number(now.toLocaleString("en-GB", { timeZone: WIB_TIME_ZONE, hour: "2-digit", hour12: false }));
  return jam >= 8 && jam < 21;
}

/**
 * Klaim "saya yang mengirim sambutan booking ini". Tabel log tidak punya
 * indeks unik per booking, jadi klaimnya: sisipkan baris 'claiming', lalu
 * lihat semua klaim/kiriman untuk booking ini -- yang paling awal menang,
 * sisanya mundur dan menghapus barisnya sendiri. Aman walau dua proses
 * berjalan bersamaan, tanpa perubahan skema.
 */
async function klaim(supabase: SupabaseClient, bookingId: string, phone: string): Promise<string | null> {
  const { data: mine, error } = await supabase
    .from("wa_messages_log")
    .insert({ booking_id: bookingId, phone, template_type: TEMPLATE, status: "claiming" })
    .select("id")
    .single();
  if (error || !mine) return null;

  const { data: semua } = await supabase
    .from("wa_messages_log")
    .select("id, created_at")
    .eq("booking_id", bookingId)
    .eq("template_type", TEMPLATE)
    .in("status", ["claiming", "sent"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (semua?.[0]?.id === mine.id) return mine.id;

  await supabase.from("wa_messages_log").delete().eq("id", mine.id);
  return null;
}

interface Kandidat {
  id: string;
  sumber: string;
  tgl_checkin: string;
  tgl_checkout: string;
  guest_nama: string | null;
  guests: { nama: string | null; hp: string | null } | null;
}

export interface HasilSambutan {
  dilewati?: string;
  terkirim: number;
  gagal: number;
}

export async function kirimSambutanOta(supabase: SupabaseClient, now: Date = new Date()): Promise<HasilSambutan> {
  if (!dalamJamKirim(now)) return { dilewati: "di luar 08.00-21.00 WIB", terkirim: 0, gagal: 0 };

  const tigaHariLalu = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const batasBawah = new Date(Math.max(Date.parse(SAMBUTAN_MULAI), Date.parse(tigaHariLalu))).toISOString();

  const { data, error } = await supabase
    .from("bookings")
    .select("id, sumber, tgl_checkin, tgl_checkout, guest_nama, guests(nama, hp)")
    .in("sumber", SUMBER as unknown as string[])
    .eq("status", "terjadwal")
    .gte("created_at", batasBawah)
    .gte("tgl_checkin", todayISO(now))
    .order("created_at", { ascending: true })
    .limit(30);
  if (error) throw new Error(`gagal membaca booking OTA: ${error.message}`);
  const kandidat = (data ?? []) as unknown as Kandidat[];
  if (kandidat.length === 0) return { terkirim: 0, gagal: 0 };

  const { data: sudah } = await supabase
    .from("wa_messages_log")
    .select("booking_id")
    .eq("template_type", TEMPLATE)
    .in("status", ["claiming", "sent"])
    .in("booking_id", kandidat.map((k) => k.id));
  const sudahDisambut = new Set((sudah ?? []).map((r) => r.booking_id));

  let terkirim = 0;
  let gagal = 0;
  for (const b of kandidat.filter((k) => !sudahDisambut.has(k.id)).slice(0, MAKS_PER_JALAN)) {
    const phone = (b.guests?.hp ?? "").replace(/\D/g, "");
    if (phone.length < 8) continue;

    const logId = await klaim(supabase, b.id, phone);
    if (!logId) continue;

    const bahasa: BahasaSambutan = bahasaDariNomor(phone);
    const nama = rapikanNama(b.guests?.nama || b.guest_nama || "");
    const isi = teksSambutan({ nama, sumber: b.sumber, checkin: b.tgl_checkin, checkout: b.tgl_checkout, bahasa });

    const sent = await kirimDariNomorUtama(phone, isi);
    await supabase
      .from("wa_messages_log")
      .update({ status: sent.success ? "sent" : "failed", message: isi, response: sent.success ? null : { error: sent.error } })
      .eq("id", logId);

    if (!sent.success) {
      gagal++;
      console.error("[otaWelcome] gagal mengirim sambutan", b.id, sent.error);
      continue;
    }
    terkirim++;

    // Dicatat di Chat supaya resepsionis melihat apa yang sudah dikirim, dan
    // bahasanya diingat untuk terjemahan balasan berikutnya. Gagal mencatat
    // tidak mengulang kiriman (log sudah 'sent').
    try {
      const percakapan = await cariAtauBuatPercakapan(supabase, phone, nama || undefined);
      await catatPesan(supabase, { conversationId: percakapan.conversationId, arah: "keluar", isi, isPerintahOtomatis: true });
      await supabase.from("wa_conversations").update({ bahasa }).eq("id", percakapan.conversationId).is("bahasa", null);
    } catch (e) {
      console.error("[otaWelcome] sambutan terkirim tapi gagal dicatat di Chat", e instanceof Error ? e.message : String(e));
    }
  }
  return { terkirim, gagal };
}
