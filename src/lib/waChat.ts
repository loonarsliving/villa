import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { nomorKanonik, samePhoneNumber } from "./phone";

/**
 * Inti penyimpanan percakapan WhatsApp dua-arah (persetujuan owner
 * 2026-09-27, tabel `wa_conversations` / `wa_conversation_messages`).
 *
 * Dipakai dari DUA tempat yang harus tetap konsisten satu sama lain:
 * `/api/wa/webhook` (pesan masuk dari WhaCenter, termasuk yang memicu
 * perintah baku LUNAS/PROMO/dll.) dan `/api/chat/*` (balasan staf dari
 * halaman Chat Front Desk). Logikanya disatukan di sini supaya kedua
 * pemanggil tidak diam-diam berbeda perilaku.
 *
 * Sengaja TIDAK PERNAH melempar ke pemanggilnya kalau penyimpanan gagal --
 * mengikuti pola sendWa() dan sejenisnya di codebase ini: gagal mencatat
 * percakapan tidak boleh menggagalkan pengiriman WA-nya sendiri atau
 * perintah baku yang sudah bekerja (LUNAS mengunci unit, dst.). Kegagalan
 * dicatat ke console, bukan disembunyikan total.
 */

export interface ConversationMatch {
  conversationId: string;
  guestId: string | null;
  bookingId: string | null;
  statusTamu: "prospek" | "menginap" | "selesai";
}

/**
 * Booking paling relevan untuk sebuah nomor: check-in yang sedang
 * berlangsung menang atas segalanya (itulah yang membuat "menginap"
 * berarti), lalu booking terjadwal/checkout terbaru sebagai konteks.
 * Tidak mengambil dari `guests.hp` secara SQL langsung karena formatnya
 * tidak konsisten (lihat src/lib/phone.ts) -- dicocokkan di JS.
 */
export interface BookingRingkas {
  id: string;
  status: string;
}

/**
 * Booking mana yang "paling relevan" untuk sebuah tamu, dan status apa
 * yang itu tunjukkan -- dipisah jadi fungsi murni (tanpa I/O) supaya bisa
 * diuji langsung tanpa meniru seluruh rantai query Supabase.
 *
 * Urutan prioritas: check-in yang sedang berlangsung menang atas segalanya
 * (itulah yang membuat "Menginap" berarti sesuatu), lalu booking terjadwal
 * terbaru, baru checkout terbaru sebagai sisa konteks. `rows` diasumsikan
 * sudah terurut created_at menurun (booking terbaru duluan) dari sisi
 * pemanggil, supaya "terbaru" di sini benar.
 */
export function pilihBookingTerbaik(rows: BookingRingkas[]): { bookingId: string | null; statusTamu: ConversationMatch["statusTamu"] } {
  const checkinAktif = rows.find((b) => b.status === "checkin");
  if (checkinAktif) return { bookingId: checkinAktif.id, statusTamu: "menginap" };

  const terjadwal = rows.find((b) => b.status === "terjadwal");
  if (terjadwal) return { bookingId: terjadwal.id, statusTamu: "prospek" };

  const checkoutTerbaru = rows.find((b) => b.status === "checkout");
  if (checkoutTerbaru) return { bookingId: checkoutTerbaru.id, statusTamu: "selesai" };

  return { bookingId: null, statusTamu: "prospek" };
}

async function cariGuestDanBooking(
  supabase: SupabaseClient,
  phone: string,
): Promise<{ guestId: string | null; bookingId: string | null; statusTamu: ConversationMatch["statusTamu"] }> {
  const { data: guests } = await supabase.from("guests").select("id,hp").not("hp", "is", null).neq("hp", "");
  const guest = (guests ?? []).find((g) => samePhoneNumber(g.hp, phone));
  if (!guest) return { guestId: null, bookingId: null, statusTamu: "prospek" };

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id,status,tgl_checkin,tgl_checkout,created_at")
    .eq("guest_id", guest.id)
    .in("status", ["checkin", "terjadwal", "checkout"])
    .order("created_at", { ascending: false });

  const { bookingId, statusTamu } = pilihBookingTerbaik(bookings ?? []);
  return { guestId: guest.id, bookingId, statusTamu };
}

/**
 * Cari atau buat percakapan untuk sebuah nomor, dan segarkan pencocokan
 * tamu/booking-nya setiap kali dipanggil -- status tamu bisa berubah
 * (prospek -> menginap -> selesai) di antara satu pesan dengan pesan
 * berikutnya, dan itu justru intinya (lihat status_tamu di tabel).
 */
export async function cariAtauBuatPercakapan(
  supabase: SupabaseClient,
  phoneMentah: string,
  namaTampilan?: string,
): Promise<ConversationMatch> {
  const phone = nomorKanonik(phoneMentah);
  const cocok = await cariGuestDanBooking(supabase, phone);

  const { data: existing } = await supabase.from("wa_conversations").select("id").eq("phone", phone).maybeSingle();

  if (existing) {
    await supabase
      .from("wa_conversations")
      .update({
        guest_id: cocok.guestId,
        booking_id: cocok.bookingId,
        status_tamu: cocok.statusTamu,
        ...(namaTampilan ? { nama_tampilan: namaTampilan } : {}),
      })
      .eq("id", existing.id);
    return { conversationId: existing.id, ...cocok };
  }

  const { data: created, error } = await supabase
    .from("wa_conversations")
    .insert({
      phone,
      nama_tampilan: namaTampilan ?? null,
      guest_id: cocok.guestId,
      booking_id: cocok.bookingId,
      status_tamu: cocok.statusTamu,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error(error?.message ?? "Gagal membuat percakapan baru");
  return { conversationId: created.id, ...cocok };
}

export interface CatatPesanInput {
  conversationId: string;
  arah: "masuk" | "keluar";
  isi: string;
  mediaUrl?: string | null;
  isPerintahOtomatis?: boolean;
  dibalasOleh?: string | null;
}

/** Simpan satu pesan dan segarkan ringkasan percakapannya (pratinjau, waktu, unread). */
export async function catatPesan(supabase: SupabaseClient, input: CatatPesanInput): Promise<void> {
  const { error: insertError } = await supabase.from("wa_conversation_messages").insert({
    conversation_id: input.conversationId,
    arah: input.arah,
    isi: input.isi,
    media_url: input.mediaUrl ?? null,
    is_perintah_otomatis: input.isPerintahOtomatis ?? false,
    dibalas_oleh: input.dibalasOleh ?? null,
  });
  if (insertError) throw new Error(insertError.message);

  const preview = input.isi.trim() || (input.mediaUrl ? "📎 Lampiran" : "");
  if (input.arah === "masuk") {
    // unread_count += 1 -- RPC kecil supaya tidak ada race dua pesan masuk
    // beruntun saling menimpa angka satu sama lain (read-then-write biasa).
    const { error: rpcError } = await supabase.rpc("wa_conversation_increment_unread", {
      p_conversation_id: input.conversationId,
      p_preview: preview,
    });
    if (rpcError) throw new Error(rpcError.message);
  } else {
    const { error: updateError } = await supabase
      .from("wa_conversations")
      .update({ last_message_at: new Date().toISOString(), last_message_preview: preview })
      .eq("id", input.conversationId);
    if (updateError) throw new Error(updateError.message);
  }
}

/** Dipakai webhook: mencatat pesan masuk tanpa melempar kalau gagal -- lihat catatan di atas berkas ini. */
export async function catatPesanMasukAman(
  supabase: SupabaseClient,
  phoneMentah: string,
  isi: string,
  opts: { namaTampilan?: string; mediaUrl?: string } = {},
): Promise<ConversationMatch | null> {
  try {
    const match = await cariAtauBuatPercakapan(supabase, phoneMentah, opts.namaTampilan);
    await catatPesan(supabase, {
      conversationId: match.conversationId,
      arah: "masuk",
      isi,
      mediaUrl: opts.mediaUrl,
    });
    return match;
  } catch (e) {
    console.error("[waChat] gagal mencatat pesan masuk", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Dipakai webhook: mencatat balasan otomatis (LUNAS/PROMO/dll.) tanpa melempar kalau gagal. */
export async function catatBalasanOtomatisAman(supabase: SupabaseClient, conversationId: string, isi: string): Promise<void> {
  try {
    await catatPesan(supabase, { conversationId, arah: "keluar", isi, isPerintahOtomatis: true });
  } catch (e) {
    console.error("[waChat] gagal mencatat balasan otomatis", e instanceof Error ? e.message : String(e));
  }
}
