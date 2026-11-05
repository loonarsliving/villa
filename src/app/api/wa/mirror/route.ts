import { after, NextResponse } from "next/server";

import { buatDrafAiAman } from "@/lib/aiResepsionis";
import { secretsMatch } from "@/lib/internalSecret";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bacaPilihanMenu, isiPilihanMenginap, teksMenuSapaan, TEKS_PILIHAN_LAIN } from "@/lib/menuSapaan";
import { kirimDariNomorUtama } from "@/lib/mkhsistemWa";
import {
  bolehDapatMenuSapaan,
  bolehMasukResepsionis,
  catatPesanMasukAman,
  kirimSapaanPertamaAman,
  menuSapaanTertunda,
  terjemahkanPesanMasukAman,
} from "@/lib/waChat";
import { isiNotifChatTamu, kirimPushKePeranAman, totalChatBelumDibaca } from "@/lib/webPush";
import { PERAN_NOTIF_CHAT_TAMU } from "@/lib/webPushConfig";
import { normalizeInbound } from "@/lib/whacenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// after() menerjemahkan lalu meminta draf AI (bisa dua panggilan AI + cek ketersediaan).
export const maxDuration = 60;

/**
 * Salinan pesan masuk ke nomor utama 082228885223, diteruskan oleh Mkhsistem.
 *
 * Perangkat WhaCenter nomor itu mengirim webhook ke Mkhsistem, bukan ke
 * villa (dibuktikan dari ai_integration_logs 2026-09-27), dan owner memilih
 * nomor itu tetap jadi nomor chat resepsionis. Mkhsistem meneruskan payload
 * mentah WhaCenter ke sini.
 *
 * Hanya tamu villa dan penanya soal menginap yang dicatat (bolehMasukResepsionis);
 * chat bisnis lain di 0822 dilewati.
 *
 * Jawabannya dibaca Mkhsistem (lib/ai/domains/villa-chat-mirror.ts):
 * `villa: true` berarti percakapan ini milik resepsionis, jadi Mkhsistem tidak
 * membalas dengan AI atau "pilih proyek". Karyawan/kontraktor Mkhsistem sudah
 * disaring di bolehMasukResepsionis, jadi Mkhsistem cukup mengikuti nilai ini.
 *
 * Satu-satunya balasan otomatis ke tamu adalah sapaan pertama, hanya untuk nomor
 * yang baru pertama kali chat DAN belum dikenal sebagai tamu (`!hasil.guestId`).
 * Tanpa syarat kedua ini, tamu yang sudah punya data/booking -- misalnya yang
 * baru saja kita kirimi pengingat check-in -- tetap disapa seolah orang asing
 * begitu dia membalas (kasus nyata 2026-09-28, lihat teksSapaanPertama).
 * Sapaan dikirim lewat after(), setelah Mkhsistem menerima jawaban ini, supaya
 * jalurnya tidak ikut tertahan.
 *
 * Setiap pesan yang tercatat juga dibuatkan DRAF balasan AI (src/lib/aiResepsionis.ts)
 * lewat after(). Draf itu hanya tampil di layar Chat -- tidak ada yang terkirim ke
 * tamu tanpa resepsionis menekan Kirim.
 *
 * Menu sapaan (owner 2026-11-05, src/lib/menuSapaan.ts): orang asing yang
 * membuka dengan salam saja ("Halo kak") dibalas menu 1/2/3. Jawaban "1" dicatat
 * di Chat resepsionis (lalu disapa seperti biasa); "2"/"3" dibalas singkat dan
 * tetap milik Mkhsistem/owner. Saat menu dikirim, jawabannya `villa: true` agar
 * Mkhsistem tidak ikut membalas.
 *
 * HANYA mencatat -- tidak menjalankan LUNAS/PROMO/dll. Perintah-perintah itu
 * sudah diproses Mkhsistem untuk nomor ini; memprosesnya lagi di sini berarti
 * owner menerima balasan konfirmasi dua kali.
 */
/** Payload WhaCenter membawa ad_reply berisi (klik iklan Meta) -- urusan sales, tanpa menu sapaan. */
function adaIklan(payload: unknown): boolean {
  const ad = (payload as Record<string, unknown> | null)?.ad_reply;
  if (!ad || typeof ad !== "object") return false;
  return Object.values(ad as Record<string, unknown>).some((v) => v !== null && v !== undefined && v !== "");
}

export async function POST(request: Request) {
  const expected = (process.env.VILLA_BRIDGE_SECRET ?? "").trim();
  if (!expected) {
    console.error("[wa/mirror] VILLA_BRIDGE_SECRET belum dikonfigurasi");
    return NextResponse.json({ ok: false, error: "bridge not configured" }, { status: 503 });
  }
  if (!secretsMatch((request.headers.get("x-internal-secret") ?? "").trim(), expected)) {
    console.warn("[wa/mirror] x-internal-secret tidak cocok");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const payload: unknown = await request.json().catch(() => null);
  const inbound = normalizeInbound(payload);
  if (!inbound) return NextResponse.json({ ok: true, villa: false, skipped: "bukan pesan perorangan" });

  const supabase = supabaseAdmin();
  let isiDicatat = inbound.text;
  if (!(await bolehMasukResepsionis(supabase, inbound.sender, inbound.text))) {
    // Menu sapaan (src/lib/menuSapaan.ts, owner 2026-11-05): salam saja dari
    // orang asing dijawab menu; jawaban "1" baru dibawa ke resepsionis.
    const pilihan = inbound.mediaUrl ? null : bacaPilihanMenu(inbound.text);
    if (pilihan && (await menuSapaanTertunda(supabase, inbound.sender))) {
      if (pilihan !== "menginap") {
        after(async () => {
          const sent = await kirimDariNomorUtama(inbound.sender, TEKS_PILIHAN_LAIN);
          if (!sent.success) console.error("[wa/mirror] balasan pilihan menu gagal dikirim", sent.error);
        });
        return NextResponse.json({ ok: true, villa: false, skipped: `pilihan menu sapaan: ${pilihan}` });
      }
      isiDicatat = isiPilihanMenginap(inbound.text);
    } else if (!inbound.mediaUrl && (await bolehDapatMenuSapaan(supabase, inbound.sender, inbound.text, adaIklan(payload)))) {
      after(async () => {
        const sent = await kirimDariNomorUtama(inbound.sender, teksMenuSapaan(inbound.senderName));
        if (!sent.success) console.error("[wa/mirror] menu sapaan gagal dikirim", sent.error);
      });
      // villa: true supaya Mkhsistem tidak ikut membalas (tidak dobel dengan
      // "pilih proyek" kalau ai_lead_manual_takeover suatu saat dimatikan).
      // Percakapan resepsionis belum dibuat -- baru setelah tamu memilih 1.
      return NextResponse.json({ ok: true, villa: true, menu: true, tercatat: false });
    } else {
      return NextResponse.json({ ok: true, villa: false, skipped: "bukan tamu atau penanya villa" });
    }
  }

  const hasil = await catatPesanMasukAman(supabase, inbound.sender, isiDicatat, {
    namaTampilan: inbound.senderName,
    mediaUrl: inbound.mediaUrl,
  });

  // Percakapan Excellent Living (satu nomor WA untuk PL & EL): tanpa push ke
  // manager PL dan tanpa draf AI (AI resepsionis berisi info villa PL).
  if (hasil && hasil.properti === "PL") {
    // Notifikasi ke manager (Rebecca) -- push HP + angka di ikon aplikasi
    // (owner 2026-10-23). Lewat after() supaya Mkhsistem tidak menunggu.
    after(async () => {
      const { title, body } = isiNotifChatTamu({
        nama: inbound.senderName,
        phone: inbound.sender,
        text: inbound.text,
        adaMedia: Boolean(inbound.mediaUrl),
      });
      await kirimPushKePeranAman(supabase, PERAN_NOTIF_CHAT_TAMU, {
        title,
        body,
        link: `/manager/chat?c=${hasil.conversationId}`,
        badge: await totalChatBelumDibaca(supabase),
        tag: `chat-${hasil.conversationId}`,
      });
    });

    // Terjemahan dulu, baru draf: AI membaca versi Indonesia dari pesan tamu asing.
    after(async () => {
      await terjemahkanPesanMasukAman(supabase, hasil.conversationId, hasil.messageId, inbound.text);
      if (inbound.text.trim()) await buatDrafAiAman(supabase, hasil.conversationId, hasil.messageId);
    });
  }
  if (hasil?.baru && !hasil.guestId) {
    after(() => kirimSapaanPertamaAman(supabase, hasil.conversationId, inbound.sender, inbound.senderName, inbound.text));
  }

  return NextResponse.json({ ok: true, villa: true, tercatat: hasil !== null });
}
