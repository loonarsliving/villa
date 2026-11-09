import { after, NextResponse } from "next/server";

import { buatDrafAiAman } from "@/lib/aiResepsionis";
import { secretsMatch } from "@/lib/internalSecret";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { aiResepsionisAktifUntuk } from "@/lib/aiResepsionisPengetahuan";
import {
  bacaPilihanMenu,
  hanyaSapaan,
  isiPilihanMenginap,
  isiPilihanMenginapEl,
  JAWABAN_KEBEBASAN,
  pertanyaanKebebasan,
  teksMenuSapaan,
  teksPengingatMenu,
  TEKS_PILIHAN_LAIN,
} from "@/lib/menuSapaan";
import { kirimDariNomorUtama } from "@/lib/mkhsistemWa";
import {
  bolehMasukResepsionis,
  catatBalasanOtomatisAman,
  catatPesanMasukAman,
  kirimSapaanPertamaAman,
  statusMenuSapaan,
  sudahDijawabKebebasan,
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
 * Menu wajib (owner 2026-11-05, diperketat 2026-11-08; src/lib/menuSapaan.ts):
 * orang asing yang membuka dengan salam ("Halo kak"), atau bertanya menginap tanpa
 * menyebut properti, dibalas menu 1-4 dan HARUS memilih angka. Pertanyaan bebas
 * sebelum memilih diingatkan sekali. Jawaban "1" (PL) / "2" (EL) membuka Chat
 * resepsionis properti itu, dan pertanyaan yang sudah ditulis ikut dicatat;
 * "3"/"4" dibalas singkat dan tetap milik Mkhsistem/owner. Saat menu/pengingat
 * dikirim, jawabannya `villa: true` agar Mkhsistem tidak ikut membalas.
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
  let pertanyaanSebelumnya: string[] = [];
  let lewatMenu = false;

  // Menu wajib (owner 2026-11-08, src/lib/menuSapaan.ts): orang asing yang
  // membuka dengan salam, atau bertanya menginap tanpa menyebut properti, harus
  // memilih angka dulu. Pertanyaan bebas sebelum memilih hanya diingatkan sekali.
  const menu = inbound.mediaUrl ? null : await statusMenuSapaan(supabase, inbound.sender, inbound.text, adaIklan(payload));
  if (menu) {
    const kirimMenu = (isi: string | string[], label: string) =>
      after(async () => {
        for (const satu of Array.isArray(isi) ? isi : [isi]) {
          const sent = await kirimDariNomorUtama(inbound.sender, satu);
          if (!sent.success) {
            console.error(`[wa/mirror] ${label} gagal dikirim`, sent.error);
            break;
          }
        }
      });
    // Pertanyaan "bebas / syariah" dijawab kalimat tetap owner (menuSapaan.ts), lalu menu
    // atau pengingat menyusul supaya tamu tetap memilih. Sudah pernah dijawab = tidak diulang.
    if (pertanyaanKebebasan(inbound.text)) {
      const sudahDijawab = menu.tahap === "menunggu" && menu.pertanyaan.some(pertanyaanKebebasan);
      const pesan: string[] = [];
      if (!sudahDijawab) pesan.push(JAWABAN_KEBEBASAN);
      if (menu.tahap === "baru") pesan.push(teksMenuSapaan(inbound.senderName, true));
      else if (!menu.pengingatSudah) pesan.push(teksPengingatMenu());
      if (pesan.length) {
        kirimMenu(pesan, "jawaban kebebasan + menu");
        return NextResponse.json({ ok: true, villa: true, menu: true, faq: "kebebasan", tercatat: false });
      }
    }
    // villa: true supaya Mkhsistem tidak ikut membalas ("pilih proyek"); pesannya
    // tetap tersimpan di sisi Mkhsistem. Percakapan resepsionis baru dibuat setelah memilih 1/2.
    if (menu.tahap === "baru") {
      kirimMenu(teksMenuSapaan(inbound.senderName, !hanyaSapaan(inbound.text)), "menu sapaan");
      return NextResponse.json({ ok: true, villa: true, menu: true, tercatat: false });
    }
    const pilihan = bacaPilihanMenu(inbound.text);
    if (pilihan === "properti" || pilihan === "lainnya") {
      kirimMenu(TEKS_PILIHAN_LAIN, "balasan pilihan menu");
      return NextResponse.json({ ok: true, villa: false, skipped: `pilihan menu sapaan: ${pilihan}` });
    }
    if (pilihan) {
      lewatMenu = true;
      pertanyaanSebelumnya = menu.pertanyaan;
      isiDicatat = pilihan === "menginap_el" ? isiPilihanMenginapEl(inbound.text) : isiPilihanMenginap(inbound.text);
    } else if (hanyaSapaan(inbound.text)) {
      return NextResponse.json({ ok: true, villa: false, skipped: "salam ulang sebelum memilih menu" });
    } else if (!menu.pengingatSudah) {
      kirimMenu(teksPengingatMenu(), "pengingat menu");
      return NextResponse.json({ ok: true, villa: true, menu: true, pengingat: true, tercatat: false });
    }
    // Sudah diingatkan dan tamu tetap menulis bebas: tidak ditahan lagi, ikut penyaringan biasa.
  }

  if (!lewatMenu && !(await bolehMasukResepsionis(supabase, inbound.sender, inbound.text))) {
    return NextResponse.json({ ok: true, villa: false, skipped: "bukan tamu atau penanya villa" });
  }

  // Pertanyaan yang ditulis tamu sebelum memilih tidak boleh hilang: dicatat
  // lebih dulu supaya resepsionis langsung melihatnya di Chat.
  let percakapanBaru = false;
  let idAwal: string | null = null;
  for (const t of pertanyaanSebelumnya) {
    const awal = await catatPesanMasukAman(supabase, inbound.sender, t, { namaTampilan: inbound.senderName });
    if (awal?.baru) percakapanBaru = true;
    if (awal) idAwal = awal.conversationId;
  }
  // Pertanyaan "bebas / syariah" yang sudah dijawab otomatis sebelum tamu memilih menu:
  // jawabannya dicatat juga supaya resepsionis tahu tamu sudah mendapat kalimat itu.
  if (idAwal && pertanyaanSebelumnya.some(pertanyaanKebebasan)) {
    await catatBalasanOtomatisAman(supabase, idAwal, JAWABAN_KEBEBASAN);
  }

  const hasil = await catatPesanMasukAman(supabase, inbound.sender, isiDicatat, {
    namaTampilan: inbound.senderName,
    mediaUrl: inbound.mediaUrl,
  });
  const teksNotif = pertanyaanSebelumnya.length ? pertanyaanSebelumnya[pertanyaanSebelumnya.length - 1] : inbound.text;

  // Tamu percakapan PL yang menanyakan "bebas / syariah": jawaban tetap dikirim langsung
  // (tanpa menunggu resepsionis) dan dicatat di Chat. Putusan diambil di sini, bukan di
  // after(), supaya draf AI untuk pesan yang sudah terjawab tidak ikut dibuat.
  const jawabKebebasan =
    !!hasil && hasil.properti === "PL" && !lewatMenu && !inbound.mediaUrl && pertanyaanKebebasan(inbound.text) && !(await sudahDijawabKebebasan(supabase, hasil.conversationId));
  if (jawabKebebasan && hasil) {
    after(async () => {
      const sent = await kirimDariNomorUtama(inbound.sender, JAWABAN_KEBEBASAN);
      if (!sent.success) return console.error("[wa/mirror] jawaban kebebasan gagal dikirim", sent.error);
      await catatBalasanOtomatisAman(supabase, hasil.conversationId, JAWABAN_KEBEBASAN);
    });
  }

  // Percakapan Excellent Living (satu nomor WA untuk PL & EL): tanpa push ke
  // manager PL (Rebecca mengurus PL).
  if (hasil && hasil.properti === "PL") {
    // Notifikasi ke manager (Rebecca) -- push HP + angka di ikon aplikasi
    // (owner 2026-10-23). Lewat after() supaya Mkhsistem tidak menunggu.
    after(async () => {
      const { title, body } = isiNotifChatTamu({
        nama: inbound.senderName,
        phone: inbound.sender,
        text: teksNotif,
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

  }
  // Draf AI resepsionis untuk properti yang punya buku pengetahuan (PL, dan EL
  // sejak 2026-11-09 dengan pengetahuan EL sendiri -- aiResepsionisPengetahuan.ts).
  if (hasil && aiResepsionisAktifUntuk(hasil.properti)) {
    // Terjemahan dulu, baru draf: AI membaca versi Indonesia dari pesan tamu asing.
    after(async () => {
      await terjemahkanPesanMasukAman(supabase, hasil.conversationId, hasil.messageId, inbound.text);
      if (inbound.text.trim() && !jawabKebebasan) await buatDrafAiAman(supabase, hasil.conversationId, hasil.messageId);
    });
  }
  if ((hasil?.baru || percakapanBaru) && hasil && !hasil.guestId) {
    // isiDicatat (bukan teks mentah "2"): sapaan membaca "Excellent Living" dari sini.
    after(() => kirimSapaanPertamaAman(supabase, hasil.conversationId, inbound.sender, inbound.senderName, isiDicatat));
  }

  return NextResponse.json({ ok: true, villa: true, tercatat: hasil !== null });
}
