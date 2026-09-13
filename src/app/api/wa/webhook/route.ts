import { NextResponse } from "next/server";

import { normalizeInbound, sendWhatsAppText, whacenterDeviceId } from "@/lib/whacenter";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Balasan WhatsApp masuk, langsung ke villa — tidak lagi lewat Mkhsistem.
 *
 * Ini separuh yang paling mudah terlupakan saat memindahkan WhatsApp.
 * Mengirim memang cuma satu fungsi, tapi yang membuat sistem ini hidup
 * adalah BALASAN owner: "LUNAS <kode>" mengunci unit tamu, "PROMO <kode>"
 * menyetujui kiriman promo. Selama ini yang mengenali balasan itu adalah
 * webhook-handler milik Mkhsistem. Kalau hanya sisi keluar yang dipindah,
 * konfirmasi pembayaran berhenti bekerja TANPA satu pun pesan galat.
 *
 * Keputusan tentang siapa boleh melakukan apa TIDAK diulang di sini.
 * Semuanya sudah ada di villa-api (/bridge/confirm-payment,
 * /bridge/promo-approve, /bridge/promo-reject, /bridge/guest-opt-out),
 * lengkap dengan penguncian ke nomor owner. Berkas ini hanya penerjemah:
 * payload WhaCenter masuk, panggilan bridge keluar.
 */

const VILLA_API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

const LUNAS_RE = /^\s*lunas\s+([0-9a-f]{6})\s*$/i;
const PROMO_RE = /^\s*promo\s+([0-9a-f]{6})\s*$/i;
const TOLAK_RE = /^\s*(?:tolak|batal)\s+([0-9a-f]{6})\s*$/i;
const BERHENTI_RE = /^\s*(?:berhenti|stop|unsubscribe)\s*$/i;

async function bridgeSecret(): Promise<string | null> {
  const { data } = await supabaseAdmin().from("integration_settings").select("value").eq("key", "vercel_bridge").maybeSingle();
  const secret = (data?.value as { secret?: string } | undefined)?.secret;
  return secret?.trim() || null;
}

async function callBridge(path: string, body: unknown, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${VILLA_API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch (e) {
    console.error(`[wa/webhook] ${path} tidak bisa dihubungi`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

function rupiah(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? `Rp ${Math.round(v).toLocaleString("id-ID")}` : "-";
}

export async function POST(request: Request) {
  // WhaCenter tidak mengirimkan rahasia apa pun, jadi tidak ada yang bisa
  // dicocokkan di sini. Yang menjaga: device_id di payload harus perangkat
  // KITA, dan setiap perintah tetap diverifikasi ulang oleh villa-api
  // terhadap nomor owner. Endpoint ini sendiri tidak punya wewenang apa pun.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: true, skipped: "body bukan JSON" });
  }

  const device = (payload as Record<string, unknown>)?.device_id;
  const ours = whacenterDeviceId();
  if (ours && typeof device === "string" && device && device !== ours) {
    console.warn("[wa/webhook] payload dari device_id lain, diabaikan");
    return NextResponse.json({ ok: true, skipped: "device lain" });
  }

  const inbound = normalizeInbound(payload);
  if (!inbound) return NextResponse.json({ ok: true, skipped: "bukan pesan teks perorangan" });

  const text = inbound.text;
  const lunas = text.match(LUNAS_RE);
  const promo = text.match(PROMO_RE);
  const tolak = text.match(TOLAK_RE);
  const berhenti = BERHENTI_RE.test(text);

  // Pesan biasa tidak dibalas apa pun. Villa bukan asisten percakapan;
  // membalas setiap pesan tamu dengan sesuatu akan lebih membingungkan
  // daripada diam.
  if (!lunas && !promo && !tolak && !berhenti) {
    return NextResponse.json({ ok: true, skipped: "bukan perintah yang dikenali" });
  }

  const secret = await bridgeSecret();
  if (!secret) {
    console.error("[wa/webhook] integration_settings.vercel_bridge.secret belum diisi");
    return NextResponse.json({ ok: true, skipped: "bridge belum dikonfigurasi" });
  }

  let reply: string | null = null;

  if (berhenti) {
    const body = await callBridge("/bridge/guest-opt-out", { hp: inbound.sender }, secret);
    reply =
      body?.success === true
        ? "Baik, kami tidak akan mengirimkan info promo lagi ke nomor ini. Terima kasih, dan pintu kami tetap terbuka kalau suatu saat ingin menginap lagi."
        : "Baik, permintaan Anda kami catat. Kalau masih menerima pesan dari kami, mohon balas sekali lagi ya.";
  } else if (lunas) {
    const kode = lunas[1].toUpperCase();
    const b = await callBridge("/bridge/confirm-payment", { code: kode }, secret);
    if (!b) reply = `Konfirmasi gagal: server villa tidak bisa dihubungi. Kode ${kode} belum diproses.`;
    else if (b.success === true && b.already_confirmed === true)
      reply = `Kode ${kode} sudah dikonfirmasi sebelumnya — unit ${b.unit_nomor ?? "-"} atas nama ${b.guest_nama ?? "-"} sudah terkunci.`;
    else if (b.success === true)
      reply =
        `Siap, pembayaran dikonfirmasi.\n\n${b.guest_nama ?? "-"}\nUnit ${b.unit_nomor ?? "-"}\n` +
        `${b.tgl_checkin ?? "-"} s/d ${b.tgl_checkout ?? "-"}\n${rupiah(b.total_bayar)}\n\n` +
        `Unit sudah masuk kalender dan invoice ${b.invoice_no ?? "-"} sudah bisa dicetak tamu.`;
    else if (b.reason === "unit_conflict")
      reply =
        `Pembayaran dicatat dan invoice ${b.invoice_no ?? "-"} terbit, TAPI unit ${b.unit_nomor ?? "-"} keburu terisi booking lain.\n\n` +
        `Tamu ${b.guest_nama ?? "-"} perlu dihubungi untuk pindah unit atau reschedule.`;
    else reply = `Kode ${kode} tidak ditemukan di booking yang menunggu pembayaran. Mohon cek lagi kodenya.`;
  } else if (tolak) {
    const kode = tolak[1].toUpperCase();
    const b = await callBridge("/bridge/promo-reject", { kode }, secret);
    reply =
      b?.success === true
        ? `Baik, usulan promo ${kode} dibatalkan. Tidak ada pesan yang dikirim ke tamu.`
        : b?.reason === "sudah_terkirim"
          ? `Usulan ${kode} sudah terlanjur dikirim, jadi tidak bisa dibatalkan lagi.`
          : `Usulan ${kode} tidak ditemukan. Mohon cek lagi kodenya.`;
  } else if (promo) {
    const kode = promo[1].toUpperCase();
    const b = await callBridge("/bridge/promo-approve", { kode }, secret);
    if (!b) reply = `Gagal memproses ${kode}: server villa tidak bisa dihubungi. Belum ada pesan yang dikirim ke tamu.`;
    else if (b.success === true && b.already_sent === true) reply = `Usulan ${kode} sudah dikirim sebelumnya.`;
    else if (b.success === true) {
      const terkirim = Number(b.terkirim ?? 0);
      const sisa = Number(b.sisa ?? 0);
      const nama = (b.promo as Record<string, unknown> | undefined)?.nama ?? "-";
      reply = `Siap, promo "${nama}" dikirim ke ${terkirim} tamu.`;
      if (Number(b.gagal ?? 0) > 0) reply += `\n${b.gagal} gagal dicatat.`;
      if (sisa > 0) reply += `\n\nMasih ada ${sisa} tamu dalam antrean — balas PROMO ${kode} sekali lagi untuk melanjutkan.`;
    } else {
      const alasan: Record<string, string> = {
        not_found: `Kode ${kode} tidak ditemukan.`,
        kedaluwarsa: `Usulan ${kode} sudah kedaluwarsa (lewat 48 jam), jadi tidak dikirim.`,
        ditolak: `Usulan ${kode} sudah ditolak sebelumnya.`,
        promo_tidak_aktif: `Promonya sudah tidak aktif, jadi ${kode} tidak dikirim.`,
      };
      reply = alasan[String(b.reason ?? "")] ?? `Kode ${kode} tidak bisa diproses.`;
    }
  }

  if (reply) {
    const sent = await sendWhatsAppText(inbound.sender, reply);
    if (!sent.success) console.error("[wa/webhook] balasan gagal dikirim", sent.error);
  }

  // Selalu 200. WhaCenter tidak perlu tahu urusan internal kita, dan
  // status galat di sini bisa membuatnya mengulang kiriman yang sama.
  return NextResponse.json({ ok: true });
}
