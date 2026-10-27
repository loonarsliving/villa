import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { terjemahkanChat } from "./aiBridge";
import { kirimDariNomorUtama } from "./mkhsistemWa";
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
  /** true hanya untuk pesan yang membuat percakapan ini -- dasar sapaan pertama. */
  baru: boolean;
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

/**
 * Penanda pesan tentang MENGINAP di villa. Sebagian diambil dari teks otomatis
 * tombol WhatsApp halaman Private Living di loonars.id. Kata "villa" saja
 * sengaja tidak dipakai: nomor 0822 juga melayani penjualan properti, dan di
 * Mkhsistem "villa" adalah tipe rumah yang DIJUAL. "booking" juga tidak dipakai,
 * karena "booking fee" rumah memakai kata yang sama.
 */
const PENANDA_SEWA_VILLA: RegExp[] = [
  /\bloonars\s+(private\s+)?living\b/i,
  /\bprivate\s+living\b/i,
  /\b(menginap|nginap|nginep)\b/i,
  /\bstay\s?cation\b/i,
  /\bper\s?malam\b/i,
  /\bsewa\s+villa\b/i,
];

/**
 * Penanda longgar untuk tamu yang masih bertanya-tanya (permintaan owner
 * 2026-10-15, supaya owner tidak membalas satu per satu): kata "villa", minta
 * pricelist/tarif, check-in/out, ketersediaan kamar, weekend, reservasi, fasilitas.
 * Karena "villa"/"booking"/"harga" juga dipakai calon pembeli properti di nomor
 * yang sama, penanda ini TIDAK berlaku kalau pesan juga berbau jual-beli properti
 * (PENANDA_PROPERTI) -- pesan seperti itu tetap milik sales.
 */
const PENANDA_TANYA_VILLA: RegExp[] = [
  /\bvilla(nya)?\b/i,
  /\bprice\s?list(nya)?\b/i,
  /\bdaftar\s+(harga|tarif)\b/i,
  /\b(list|info)\s+(harga|tarif)\b/i,
  /\btarif\b/i,
  /\bcheck[\s-]?(in|out)\b/i,
  /\bche?k\s?(in|out)\b/i,
  /\b(kamar|room)\s+(kosong|tersedia|available)\b/i,
  /\b(available|availability|ketersediaan)\b/i,
  /\b(weekend|weekday|long\s?weekend)\b/i,
  /\b(reservasi|reservation)\b/i,
  /\b(extra\s?bed|kolam\s+renang|private\s+pool|bbq)\b/i,
  /\bbooking\b/i,
];

const PENANDA_PROPERTI: RegExp[] = [
  /\b(beli|membeli|dibeli|jual|dijual|jualan)\b/i,
  /\b(investasi|investor|invest|profit\s?sharing|bagi\s?hasil|dividen)\b/i,
  /\b(kpr|cicil|cicilan|angsuran|dp|uang\s+muka|booking\s+fee|kavling|tanah|subsidi|sertifikat|shm|rumah)\b/i,
  /\b(tipe|type)\s?\d+/i,
];

export function menyebutSewaVilla(teks: string): boolean {
  if (PENANDA_SEWA_VILLA.some((re) => re.test(teks))) return true;
  if (PENANDA_PROPERTI.some((re) => re.test(teks))) return false;
  return PENANDA_TANYA_VILLA.some((re) => re.test(teks));
}

/**
 * Teks bawaan WhatsApp saat orang menekan iklan Click-to-WhatsApp Meta (bahasa
 * Inggris dan Indonesia, persis seperti tercatat di ai_conversations). Iklan di
 * nomor 0822 adalah iklan properti/investasi Mkhsistem, jadi pesannya milik tim
 * sales, bukan resepsionis -- walau penanya menambahkan "sewa villa" (kasus nyata
 * 2026-10-12: "Hello! Can I get more info on this? profit sharing usaha sewa villa
 * di Ciwidey bisa?" masuk Chat dan disapa sebagai tamu). Penanda iklan dari
 * WhaCenter (`ad_reply`) tidak bisa diandalkan karena sering kosong, jadi teksnya
 * yang dipakai.
 */
const PENANDA_IKLAN: RegExp[] = [
  /^\s*(hello|hi|halo)\W*\s*can i get more info(rmation)? on this\b/i,
  /^\s*(halo|hai|hello)\W*\s*bisakah saya mendapatkan info(rmasi)? (selengkapnya|lebih lanjut) tentang ini\b/i,
];

export function dariIklan(teks: string): boolean {
  return PENANDA_IKLAN.some((re) => re.test(teks));
}

/**
 * Pesan yang dibuka dari tombol WhatsApp Private Living di loonars.id: semua
 * teks tombol itu diawali "Halo" lalu segera menyebut "Loonars (Private) Living".
 * Dipakai untuk karyawan/kontraktor: mereka hanya masuk Chat resepsionis kalau
 * jelas sedang bertanya sebagai tamu lewat website, bukan untuk obrolan kerja
 * yang kebetulan menyebut "menginap" atau "Private Living".
 */
export function dariTombolWebsite(teks: string): boolean {
  return /^\s*halo\b[\s\S]{0,60}\bloonars\s+(private\s+)?living\b/i.test(teks);
}

/**
 * Satu-satunya balasan otomatis ke tamu, hanya untuk nomor yang baru pertama
 * kali chat DAN belum dikenal sebagai tamu (keputusan owner 2026-09-27,
 * diperjelas 2026-09-28: kasus nyata "Kak Yassinta" -- nomornya sudah cocok
 * dengan data tamu/booking sejak pesan pertamanya, karena sistem sudah
 * mengirim pengingat check-in ke dia duluan, tapi tetap dapat sapaan
 * "pesan Kakak sudah kami terima" seolah dia orang asing. Sapaan ini untuk
 * nomor benar-benar tidak dikenal saja -- lihat pengecekan `!guestId` di
 * pemanggil (mirror/route.ts). Sengaja tidak bertanya apa pun dan tidak
 * menawarkan apa pun: setelah ini resepsionis yang membalas.
 */
export function teksSapaanPertama(namaTampilan?: string | null, pesanTamu?: string | null): string {
  const nama = (namaTampilan ?? "").trim();
  const sapa = nama && nama.length <= 40 ? `Halo Kak ${nama},` : "Halo Kak,";
  // Tamu yang datang dari form/tombol Excellent Living di loonars.id
  // (2026-10-27) disapa dengan nama properti yang dia tanyakan.
  const properti = /\bexcellent\s+living\b/i.test(pesanTamu ?? "") ? "Loonars Excellent Living" : "Loonars Private Living";
  return (
    `${sapa} terima kasih sudah menghubungi ${properti} Yogyakarta. ` +
    "Pesan Kakak sudah kami terima dan selanjutnya akan ditangani langsung oleh tim Hospitality Management kami."
  );
}

/** Kirim sapaan pertama dari 0822 dan catat di riwayat Chat. Tidak pernah melempar. */
export async function kirimSapaanPertamaAman(
  supabase: SupabaseClient,
  conversationId: string,
  phone: string,
  namaTampilan?: string | null,
  pesanTamu?: string | null,
): Promise<void> {
  const isi = teksSapaanPertama(namaTampilan, pesanTamu);
  const sent = await kirimDariNomorUtama(phone, isi);
  if (!sent.success) {
    console.error("[waChat] sapaan pertama gagal dikirim", sent.error);
    return;
  }
  try {
    await catatPesan(supabase, { conversationId, arah: "keluar", isi, isPerintahOtomatis: true });
  } catch (e) {
    console.error("[waChat] sapaan terkirim tapi gagal dicatat", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Nomor 0822 dipakai bersama bisnis lain (supplier, kontraktor, calon pembeli
 * properti), tapi resepsionis hanya boleh melihat tamu villa dan orang yang
 * bertanya soal menginap (keputusan owner 2026-09-27). Lolos kalau: pesannya
 * menyebut sewa villa, nomornya sudah punya percakapan (supaya pesan lanjutan
 * seperti "oke" tidak terputus), atau nomornya cocok dengan data tamu villa.
 *
 * Karyawan dan kontraktor Mkhsistem (orang dalam) memakai 0822 untuk urusan
 * kerja, jadi mereka hanya lolos kalau pesannya dibuka dari tombol website
 * Private Living (dariTombolWebsite) -- misalnya keluarga owner yang menguji
 * sebagai tamu. Tanpa ini, "tamu yang menginap di A2 komplain" dari owner akan
 * masuk ke layar resepsionis dan owner dikirimi sapaan tamu.
 *
 * Pesan dari iklan Meta (dariIklan) tidak pernah membuka percakapan baru di
 * resepsionis, walau menyebut sewa villa atau nomornya pernah jadi tamu -- iklan
 * itu urusan sales Mkhsistem (permintaan owner 2026-10-12). Hanya nomor yang
 * SUDAH punya percakapan resepsionis yang tetap lolos, supaya obrolan yang
 * sedang berjalan tidak terputus.
 *
 * Keputusan ini juga dipakai Mkhsistem: kalau lolos, Mkhsistem tidak membalas
 * dengan AI. Kalau database gagal dibaca, pesan TIDAK diloloskan: chat bisnis
 * lain lebih tidak boleh bocor ke resepsionis, dan aslinya tetap tersimpan di
 * Mkhsistem.
 */
export async function bolehMasukResepsionis(supabase: SupabaseClient, phoneMentah: string, teks: string): Promise<boolean> {
  // Pelanggan daftar refund (mkc_refund_customers) dilayani Bella (Refund & Customer
  // Relation) lewat Mkhsistem /refund -- tidak boleh masuk Chat resepsionis, walau
  // pernah jadi tamu atau pesannya menyebut villa/pricelist.
  if (await nomorPelangganRefund(supabase, phoneMentah)) return false;
  if (await orangDalamMkhsistem(supabase, phoneMentah)) return dariTombolWebsite(teks);
  const iklan = dariIklan(teks);
  if (!iklan && menyebutSewaVilla(teks)) return true;

  const phone = nomorKanonik(phoneMentah);
  const { data: existing, error: convError } = await supabase.from("wa_conversations").select("id").eq("phone", phone).maybeSingle();
  if (convError) console.error("[waChat] gagal memeriksa percakapan lama", convError.message);
  if (existing) return true;
  if (iklan) return false;

  const { data: guests, error: guestError } = await supabase.from("guests").select("hp").not("hp", "is", null).neq("hp", "");
  if (guestError) console.error("[waChat] gagal memeriksa data tamu", guestError.message);
  return (guests ?? []).some((g) => samePhoneNumber(g.hp, phone));
}

/** Nomor ada di daftar refund Mkhsistem. Gagal baca = dianggap bukan (Mkhsistem tetap mengurus refund lebih dulu). */
async function nomorPelangganRefund(supabase: SupabaseClient, phoneMentah: string): Promise<boolean> {
  const akhiran = akhiranNomor(phoneMentah);
  if (akhiran.length < 9) return false;
  const { data, error } = await supabase.from("mkc_refund_customers").select("phone").is("deleted_at", null).not("phone", "is", null);
  if (error) {
    console.error("[waChat] gagal memeriksa daftar refund", error.message);
    return false;
  }
  return (data ?? []).some((r) => !!r.phone && akhiranNomor(r.phone) === akhiran);
}

/** 9 digit terakhir, sama persis dengan findEmployeeByPhone/findContractorByPhone di Mkhsistem. */
export function akhiranNomor(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

/**
 * Karyawan aktif (`employees`) atau kontraktor (`contractor_wa_senders`) Mkhsistem
 * -- tabel milik Mkhsistem di project Supabase yang sama. Kalau salah satu gagal
 * dibaca, dianggap orang dalam (lihat bolehMasukResepsionis: gagal = tertutup).
 */
async function orangDalamMkhsistem(supabase: SupabaseClient, phoneMentah: string): Promise<boolean> {
  const akhiran = akhiranNomor(phoneMentah);
  if (akhiran.length < 9) return false;
  const cocok = (p: string | null) => !!p && akhiranNomor(p) === akhiran;

  const [karyawan, kontraktor] = await Promise.all([
    supabase.from("employees").select("phone").not("phone", "is", null).is("deleted_at", null).eq("employment_status", "active"),
    supabase.from("contractor_wa_senders").select("phone"),
  ]);
  if (karyawan.error || kontraktor.error) {
    console.error("[waChat] gagal memeriksa karyawan/kontraktor", karyawan.error?.message ?? kontraktor.error?.message);
    return true;
  }
  return (karyawan.data ?? []).some((e) => cocok(e.phone)) || (kontraktor.data ?? []).some((c) => cocok(c.phone));
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
    return { conversationId: existing.id, ...cocok, baru: false };
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

  // Dua pesan beruntun dari nomor baru: hanya satu yang menang (phone unik).
  // Yang kalah tetap dicatat ke percakapan yang sama, tanpa sapaan kedua.
  if (error?.code === "23505") {
    const { data: pemenang } = await supabase.from("wa_conversations").select("id").eq("phone", phone).maybeSingle();
    if (pemenang) return { conversationId: pemenang.id, ...cocok, baru: false };
  }
  if (error || !created) throw new Error(error?.message ?? "Gagal membuat percakapan baru");
  return { conversationId: created.id, ...cocok, baru: true };
}

export interface CatatPesanInput {
  conversationId: string;
  arah: "masuk" | "keluar";
  isi: string;
  mediaUrl?: string | null;
  isPerintahOtomatis?: boolean;
  dibalasOleh?: string | null;
  /** Keluar: teks Indonesia asli resepsionis kalau `isi` adalah terjemahannya. */
  terjemahan?: string | null;
}

/** Simpan satu pesan dan segarkan ringkasan percakapannya (pratinjau, waktu, unread). Mengembalikan id pesan. */
export async function catatPesan(supabase: SupabaseClient, input: CatatPesanInput): Promise<string> {
  const { data: inserted, error: insertError } = await supabase
    .from("wa_conversation_messages")
    .insert({
      conversation_id: input.conversationId,
      arah: input.arah,
      isi: input.isi,
      media_url: input.mediaUrl ?? null,
      is_perintah_otomatis: input.isPerintahOtomatis ?? false,
      dibalas_oleh: input.dibalasOleh ?? null,
      terjemahan: input.terjemahan ?? null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) throw new Error(insertError?.message ?? "Gagal mencatat pesan");

  // Pratinjau di daftar memakai teks yang dibaca resepsionis (Indonesia).
  const preview = (input.terjemahan ?? input.isi).trim() || (input.mediaUrl ? "📎 Lampiran" : "");
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
  return inserted.id;
}

/** Dipakai webhook: mencatat pesan masuk tanpa melempar kalau gagal -- lihat catatan di atas berkas ini. */
export async function catatPesanMasukAman(
  supabase: SupabaseClient,
  phoneMentah: string,
  isi: string,
  opts: { namaTampilan?: string; mediaUrl?: string } = {},
): Promise<(ConversationMatch & { messageId: string }) | null> {
  try {
    const match = await cariAtauBuatPercakapan(supabase, phoneMentah, opts.namaTampilan);
    const messageId = await catatPesan(supabase, {
      conversationId: match.conversationId,
      arah: "masuk",
      isi,
      mediaUrl: opts.mediaUrl,
    });
    return { ...match, messageId };
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

/**
 * Cukup panjang untuk menebak bahasa tamu? "ok", "👍", "oke kak" terlalu
 * pendek -- kalau dipakai, tamu Indonesia yang menjawab "ok" bisa tercatat
 * berbahasa Inggris dan balasan resepsionis ikut diterjemahkan. Huruf
 * non-Latin (Mandarin, Jepang, Korea, Arab, Thai, Kiril) sudah jelas
 * bahasanya dari dua huruf saja.
 */
export function cukupUntukMenebakBahasa(teks: string): boolean {
  const hurufLatin = (teks.match(/[A-Za-zÀ-ɏ]/g) ?? []).length;
  const hurufNonLatin = (teks.match(/[Ѐ-ӿ؀-ۿ฀-๿぀-ヿ㐀-鿿가-힯]/g) ?? []).length;
  return hurufLatin >= 10 || hurufNonLatin >= 2;
}

/**
 * Terjemahkan pesan masuk ke bahasa Indonesia untuk resepsionis, dan ingat
 * bahasa tamu untuk balasan berikutnya. Dijalankan setelah Mkhsistem
 * menerima jawaban (after()), jadi tidak menahan apa pun. Tidak pernah
 * melempar: kalau gagal, resepsionis tetap melihat pesan aslinya.
 */
export async function terjemahkanPesanMasukAman(supabase: SupabaseClient, conversationId: string, messageId: string, isi: string): Promise<void> {
  if (!isi.trim()) return;
  try {
    const { bahasaAsal, terjemahan } = await terjemahkanChat(isi, "id");
    if (bahasaAsal !== "id" && terjemahan.trim() && terjemahan.trim() !== isi.trim()) {
      await supabase.from("wa_conversation_messages").update({ terjemahan }).eq("id", messageId);
      await supabase.from("wa_conversations").update({ last_message_preview: terjemahan.trim() }).eq("id", conversationId);
    }
    if (cukupUntukMenebakBahasa(isi)) {
      await supabase.from("wa_conversations").update({ bahasa: bahasaAsal }).eq("id", conversationId);
    }
  } catch (e) {
    console.error("[waChat] terjemahan pesan masuk gagal", e instanceof Error ? e.message : String(e));
  }
}
