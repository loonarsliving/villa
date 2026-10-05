import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { drafBalasanChat, type DrafBalasan, type DrafBalasanInput } from "./aiBridge";
import { PENGETAHUAN_TAMU_BOOKING, PENGETAHUAN_UMUM } from "./aiResepsionisPengetahuan";

/**
 * AI resepsionis, TAHAP 1: draf saja (keputusan owner 2026-10-05).
 *
 * Setiap pesan tamu yang masuk Chat Front Desk dibuatkan satu draf balasan
 * oleh AI (Mkhsistem). Draf disimpan di wa_conversations.ai_draf dan hanya
 * TAMPIL di layar Chat -- resepsionis yang mengklik "Pakai draf" lalu Kirim.
 * Tidak ada jalur di berkas ini yang mengirim WhatsApp ke tamu.
 *
 * Penjaga kesalahan, berlapis:
 * 1. AI hanya diberi fakta dari aiResepsionisPengetahuan.ts (disetujui owner)
 *    dan dari ketersediaan villa-api (harga yang sama dengan loonars.id).
 * 2. Draf yang menyebut nominal uang yang tidak ada di kedua sumber itu
 *    DITAHAN (angkaTidakDikenal): kategorinya jadi perlu_resepsionis dan
 *    alasannya ditulis, supaya resepsionis tahu kenapa.
 * 3. Draf dianggap basi begitu ada pesan masuk lain atau balasan staf
 *    sesudahnya -- tidak ada draf lama yang menjawab pertanyaan yang salah.
 */

const VILLA_API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";
const MAKS_MALAM = 30;
const RIWAYAT = 20;

/**
 * Nominal uang (rupiah) yang disebut sebuah teks. Hanya bentuk yang jelas
 * uang: "Rp 706.000", "706.000", "250k", "100 ribu", "1,1 jt". Jam (15.00),
 * tanggal, dan angka polos tanpa Rp sengaja tidak dihitung.
 */
export function nominalDalamTeks(teks: string): number[] {
  const hasil: number[] = [];
  const re =
    /(rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(k|rb|ribu|jt|juta)?\b/gi;
  for (const m of teks.matchAll(re)) {
    const [, rp, angka, satuan] = m;
    const berkelompok = /^\d{1,3}(?:\.\d{3})+$/.test(angka);
    if (!rp && !satuan && !berkelompok) continue;
    let nilai: number;
    if (berkelompok) nilai = Number(angka.replace(/\./g, ""));
    else nilai = Number(angka.replace(",", "."));
    if (!Number.isFinite(nilai)) continue;
    const s = (satuan ?? "").toLowerCase();
    if (s === "k" || s === "rb" || s === "ribu") nilai *= 1_000;
    else if (s === "jt" || s === "juta") nilai *= 1_000_000;
    if (nilai >= 1_000) hasil.push(Math.round(nilai));
  }
  return hasil;
}

/** Nominal di draf yang tidak berasal dari pengetahuan maupun data ketersediaan. */
export function angkaTidakDikenal(draf: string, sumber: string[], hargaSistem: number[]): number[] {
  const dikenal = new Set<number>([...sumber.flatMap(nominalDalamTeks), ...hargaSistem.map(Math.round)]);
  return [...new Set(nominalDalamTeks(draf))].filter((n) => !dikenal.has(n));
}

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** "2026-10-05 14:03 (Senin)" dalam WIB. */
export function waktuWib(d: Date): string {
  const wib = new Date(d.getTime() + 7 * 3600_000);
  const iso = wib.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} (${HARI[wib.getUTCDay()]})`;
}

function tanggalWib(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

function selisihMalam(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}

interface AvailabilityRoomType {
  code: string;
  name: string;
  available: number;
  nights: number;
  price_total: number | null;
  price_per_night_avg: number | null;
}

async function cekKetersediaan(checkin: string, checkout: string): Promise<NonNullable<DrafBalasanInput["ketersediaan"]>> {
  const params = new URLSearchParams({ checkin, checkout });
  const res = await fetch(`${VILLA_API_BASE}/public/availability?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const data = (await res.json().catch(() => null)) as { room_types?: AvailabilityRoomType[] } | null;
  if (!res.ok || !Array.isArray(data?.room_types)) throw new Error(`Ketersediaan tidak terbaca (HTTP ${res.status})`);
  return {
    checkin,
    checkout,
    tipe: data.room_types.map((r) => ({
      nama: r.name,
      tersedia: Number(r.available) || 0,
      malam: Number(r.nights) || selisihMalam(checkin, checkout),
      harga_per_malam: r.price_per_night_avg ?? null,
      harga_total: r.price_total ?? null,
    })),
  };
}

type ModeAi = "mati" | "draf";

async function modeAi(supabase: SupabaseClient): Promise<ModeAi> {
  const { data } = await supabase.from("integration_settings").select("value").eq("key", "ai_resepsionis").maybeSingle();
  const mode = (data?.value as { mode?: unknown } | undefined)?.mode;
  return mode === "mati" ? "mati" : "draf";
}

/** Ada pesan masuk lain atau balasan staf sesudah pesan ini? Kalau ya, drafnya sudah tidak relevan. */
async function sudahDilewati(supabase: SupabaseClient, conversationId: string, sejak: string): Promise<boolean> {
  const { data } = await supabase
    .from("wa_conversation_messages")
    .select("arah,is_perintah_otomatis")
    .eq("conversation_id", conversationId)
    .gt("created_at", sejak);
  return (data ?? []).some((m) => m.arah === "masuk" || !m.is_perintah_otomatis);
}

interface PercakapanRingkas {
  nama_tampilan: string | null;
  status_tamu: string;
  guests: { nama: string } | null;
  bookings: { unit_nomor: string; status: string; tgl_checkin: string; tgl_checkout: string | null } | null;
}

function konteksTamu(p: PercakapanRingkas): { teks: string; punyaBooking: boolean } {
  const b = p.bookings;
  if (b && (b.status === "checkin" || b.status === "terjadwal")) {
    const kapan = `${b.tgl_checkin}${b.tgl_checkout ? ` s/d ${b.tgl_checkout}` : ""}`;
    const status = b.status === "checkin" ? "sedang menginap" : "sudah booking, belum check-in";
    return { teks: `${status}, unit ${b.unit_nomor}, ${kapan}`, punyaBooking: true };
  }
  if (b && b.status === "checkout") return { teks: `pernah menginap (unit ${b.unit_nomor}, ${b.tgl_checkin}), saat ini tidak ada booking aktif`, punyaBooking: false };
  return { teks: "calon tamu, belum ada booking", punyaBooking: false };
}

async function susunDraf(supabase: SupabaseClient, conversationId: string): Promise<DrafBalasan | null> {
  const [{ data: percakapan, error: pErr }, { data: pesan, error: mErr }] = await Promise.all([
    supabase
      .from("wa_conversations")
      .select("nama_tampilan,status_tamu,guests(nama),bookings(unit_nomor,status,tgl_checkin,tgl_checkout)")
      .eq("id", conversationId)
      .maybeSingle(),
    supabase
      .from("wa_conversation_messages")
      .select("arah,isi,terjemahan,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(RIWAYAT),
  ]);
  if (pErr || mErr || !percakapan) throw new Error(pErr?.message ?? mErr?.message ?? "percakapan tidak ditemukan");

  const p = percakapan as unknown as PercakapanRingkas;
  const { teks: konteks, punyaBooking } = konteksTamu(p);
  const pengetahuan = punyaBooking ? `${PENGETAHUAN_UMUM}\n\n${PENGETAHUAN_TAMU_BOOKING}` : PENGETAHUAN_UMUM;
  const riwayat = (pesan ?? [])
    .reverse()
    // Resepsionis membaca (dan AI menulis) dalam bahasa Indonesia -- pakai terjemahannya kalau ada.
    .map((m) => ({ arah: m.arah as "masuk" | "keluar", isi: (m.terjemahan ?? m.isi ?? "").trim(), waktu: waktuWib(new Date(m.created_at)) }))
    .filter((m) => m.isi);
  if (!riwayat.length || riwayat[riwayat.length - 1].arah !== "masuk") return null;

  const sekarang = new Date();
  const dasar: DrafBalasanInput = {
    pengetahuan,
    riwayat,
    nama_tamu: p.guests?.nama ?? p.nama_tampilan,
    konteks_tamu: konteks,
    sekarang: waktuWib(sekarang),
    ketersediaan: null,
  };

  let draf = await drafBalasanChat(dasar);
  let hargaSistem: number[] = [];

  if (draf.kategori === "cek_tanggal" && draf.cek_tanggal) {
    const { checkin, checkout } = draf.cek_tanggal;
    const malam = selisihMalam(checkin, checkout);
    if (checkin < tanggalWib(sekarang) || malam < 1 || malam > MAKS_MALAM) {
      return { kategori: "perlu_resepsionis", draf: draf.draf, cek_tanggal: null, alasan: `Tanggal yang dibaca AI tidak masuk akal (${checkin} s/d ${checkout}) -- mohon cek manual.` };
    }
    const ketersediaan = await cekKetersediaan(checkin, checkout);
    hargaSistem = ketersediaan.tipe.flatMap((t) => [t.harga_per_malam, t.harga_total]).filter((n): n is number => typeof n === "number");
    draf = await drafBalasanChat({ ...dasar, ketersediaan });
    if (draf.kategori === "cek_tanggal") {
      return { ...draf, kategori: "perlu_resepsionis", alasan: "AI masih meminta cek tanggal setelah data ketersediaan diberikan -- mohon cek manual." };
    }
  }

  const asing = angkaTidakDikenal(draf.draf, [pengetahuan], hargaSistem);
  if (asing.length) {
    return {
      ...draf,
      kategori: "perlu_resepsionis",
      alasan: `Draf ditahan: menyebut nominal yang tidak ada di data (${asing.map((n) => `Rp${n.toLocaleString("id-ID")}`).join(", ")}). Mohon cek sebelum dikirim.`,
    };
  }
  return draf;
}

/**
 * Buat draf AI untuk pesan masuk `messageId`. Dipanggil dari after() di
 * /api/wa/mirror. Tidak pernah melempar: gagal membuat draf tidak boleh
 * mengganggu pencatatan chat, dan resepsionis tetap bisa membalas manual.
 */
export async function buatDrafAiAman(supabase: SupabaseClient, conversationId: string, messageId: string): Promise<void> {
  try {
    if ((await modeAi(supabase)) === "mati") return;

    const { data: pesan } = await supabase.from("wa_conversation_messages").select("created_at").eq("id", messageId).maybeSingle();
    if (!pesan) return;

    const draf = await susunDraf(supabase, conversationId);
    if (!draf) return;
    // Selama AI berpikir, tamu bisa mengirim pesan lain atau resepsionis sudah membalas.
    if (await sudahDilewati(supabase, conversationId, pesan.created_at)) return;

    const { error } = await supabase
      .from("wa_conversations")
      .update({
        ai_draf: draf.draf,
        ai_kategori: draf.kategori,
        ai_alasan: draf.alasan || null,
        ai_draf_untuk_pesan: messageId,
        ai_draf_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[aiResepsionis] draf gagal dibuat", e instanceof Error ? e.message : String(e));
  }
}

export interface DrafAiTampil {
  draf: string;
  kategori: string;
  alasan: string | null;
  dibuat: string;
}

/** Draf untuk layar Chat -- null kalau tidak ada, atau sudah basi. */
export async function ambilDrafAi(supabase: SupabaseClient, conversationId: string): Promise<DrafAiTampil | null> {
  const { data, error } = await supabase
    .from("wa_conversations")
    .select("ai_draf,ai_kategori,ai_alasan,ai_draf_untuk_pesan,ai_draf_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data?.ai_draf || !data.ai_draf_untuk_pesan) return null;
  const { data: pesan } = await supabase.from("wa_conversation_messages").select("created_at").eq("id", data.ai_draf_untuk_pesan).maybeSingle();
  if (!pesan || (await sudahDilewati(supabase, conversationId, pesan.created_at))) return null;
  return { draf: data.ai_draf, kategori: data.ai_kategori ?? "perlu_resepsionis", alasan: data.ai_alasan, dibuat: data.ai_draf_at };
}

/** Setelah staf membalas, draf lama dibuang. Tidak pernah melempar. */
export async function hapusDrafAiAman(supabase: SupabaseClient, conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("wa_conversations")
    .update({ ai_draf: null, ai_kategori: null, ai_alasan: null, ai_draf_untuk_pesan: null, ai_draf_at: null })
    .eq("id", conversationId);
  if (error) console.error("[aiResepsionis] draf gagal dihapus", error.message);
}
