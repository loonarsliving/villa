import { NextResponse } from "next/server";

import { normalizeInbound, sendWhatsAppText, whacenterDeviceId } from "@/lib/whacenter";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { catatBalasanOtomatisAman, catatPesanMasukAman } from "@/lib/waChat";

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
/**
 * Kupon KOL (owner 2026-10-09), hanya dari nomor owner -- dicek villa-api:
 *   "KOL @akun 2"            -> kupon 2 malam gratis untuk @akun (angka opsional, bawaan 1)
 *   "KOL LIST"               -> daftar kupon
 *   "KOL BATAL KOL-ABC123"   -> matikan kupon yang belum dipakai
 */
const KOL_LIST_RE = /^\s*kol\s+list\s*$/i;
const KOL_BATAL_RE = /^\s*kol\s+batal\s+(kol-[a-z0-9]{6})\s*$/i;
const KOL_BUAT_RE = /^\s*kol\s+(?!list\s*$|batal\s)(.+?)(?:\s+(\d{1,2}))?\s*$/i;
/** Caption foto bukti transfer dividen: kode unit saja, mis. "A2", "C10". */
const UNIT_CODE_RE = /^\s*([A-Za-z]\d{1,2}|TETAP)\s*$/i;

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

function tanggalId(iso: unknown): string {
  const s = String(iso ?? "");
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Perintah KOL. null = bukan owner (diam, sama seperti perintah lain). */
async function jalankanPerintahKol(
  sender: string,
  cmd: { kolList: boolean; kolBatal: RegExpMatchArray | null; kolBuat: RegExpMatchArray | null },
  secret: string,
): Promise<string | null> {
  if (cmd.kolList) {
    const b = await callBridge("/bridge/kol", { aksi: "list", sender }, secret);
    if (b?.reason === "bukan_owner") return null;
    if (!b || b.success !== true) return "Daftar kupon KOL gagal diambil: server villa tidak bisa dihubungi.";
    const kupon = (b.kupon as Array<Record<string, unknown>>) ?? [];
    if (!kupon.length) return "Belum ada kupon KOL.\n\nBuat dengan: KOL @akun 2";
    const baris = kupon.map((k) => {
      const d = k.dipakai as Record<string, unknown> | null;
      const status = d
        ? `✅ dipakai ${d.guest_nama ?? "-"}, unit ${d.unit_nomor ?? "-"}, ${tanggalId(d.tgl_checkin)}`
        : k.aktif !== true
          ? "⛔ dibatalkan"
          : String(k.berlaku_sampai ?? "") < new Date().toISOString().slice(0, 10)
            ? "⌛ kedaluwarsa"
            : `🟢 belum dipakai, s/d ${tanggalId(k.berlaku_sampai)}`;
      return `${k.kode} · ${k.untuk} · ${k.malam_gratis} malam\n   ${status}`;
    });
    return `Kupon KOL (30 terbaru)\n\n${baris.join("\n")}`;
  }

  if (cmd.kolBatal) {
    const kode = cmd.kolBatal[1].toUpperCase();
    const b = await callBridge("/bridge/kol", { aksi: "batal", kode, sender }, secret);
    if (b?.reason === "bukan_owner") return null;
    if (!b) return `Gagal membatalkan ${kode}: server villa tidak bisa dihubungi.`;
    if (b.success === true) return `Kupon ${kode} dibatalkan. Kode ini sudah tidak bisa dipakai di loonars.id.`;
    if (b.reason === "sudah_dipakai") return `Kupon ${kode} sudah dipakai untuk booking, jadi tidak dibatalkan. Batalkan bookingnya dulu dari front desk kalau memang perlu.`;
    return `Kupon ${kode} tidak ditemukan.`;
  }

  const m = cmd.kolBuat!;
  const untuk = m[1].trim();
  const malam = m[2] ? Number(m[2]) : 1;
  const b = await callBridge("/bridge/kol", { aksi: "buat", untuk, malam, sender }, secret);
  if (b?.reason === "bukan_owner") return null;
  if (!b) return "Kupon KOL gagal dibuat: server villa tidak bisa dihubungi.";
  if (b.reason === "malam_tidak_wajar") return "Jumlah malam gratis harus 1 sampai 7.\n\nContoh: KOL @akun 2";
  if (b.reason === "untuk_kosong") return "Tulis nama atau akun KOL-nya.\n\nContoh: KOL @akun 2";
  if (b.success !== true) return `Kupon KOL gagal dibuat (${b.detail ?? b.reason ?? "sebab tidak diketahui"}).`;
  const k = b.kupon as Record<string, unknown>;
  return (
    `Kupon KOL dibuat ✅\n\nKode: ${k.kode}\nUntuk: ${k.untuk} · ${k.malam_gratis} malam gratis\n` +
    `Checkin paling lambat: ${tanggalId(k.berlaku_sampai)}\n\n` +
    `Sekali pakai. Masukkan di loonars.id, kolom Kode Promo. Tetap hanya bisa dipakai kalau ada kamar kosong di tanggal itu.`
  );
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

  // Dicatat DULU, sebelum tahu apakah ini perintah baku atau bukan --
  // sebelumnya (sampai 2026-09-27) setiap pesan bebas dari tamu yang
  // bukan LUNAS/PROMO/dll. dibuang di baris "bukan perintah yang
  // dikenali" di bawah, tidak pernah tersimpan di mana pun. Modul Chat
  // Front Desk butuh SEMUA pesan, bukan cuma yang dikenali sebagai
  // perintah. Gagal mencatat tidak boleh menggagalkan perintah baku di
  // bawah ini (lihat komentar di src/lib/waChat.ts), makanya pakai versi
  // "Aman" yang menelan errornya sendiri.
  const percakapan = await catatPesanMasukAman(supabaseAdmin(), inbound.sender, inbound.text, {
    namaTampilan: inbound.senderName,
    mediaUrl: inbound.mediaUrl,
  });

  const text = inbound.text;
  const lunas = text.match(LUNAS_RE);
  const promo = text.match(PROMO_RE);
  const tolak = text.match(TOLAK_RE);
  const berhenti = BERHENTI_RE.test(text);
  const kolList = KOL_LIST_RE.test(text);
  const kolBatal = text.match(KOL_BATAL_RE);
  const kolBuat = !kolList && !kolBatal ? text.match(KOL_BUAT_RE) : null;
  // Foto bukti transfer dividen: caption-nya kode unit saja (mis. "A2").
  const unitCode = inbound.mediaUrl ? text.match(UNIT_CODE_RE) : null;

  // Pesan biasa tidak dibalas apa pun. Villa bukan asisten percakapan;
  // membalas setiap pesan tamu dengan sesuatu akan lebih membingungkan
  // daripada diam. (Tapi sudah TERSIMPAN di atas -- resepsionis tetap
  // bisa melihat dan membalasnya sendiri lewat halaman Chat.)
  if (!lunas && !promo && !tolak && !berhenti && !unitCode && !kolList && !kolBatal && !kolBuat) {
    return NextResponse.json({ ok: true, skipped: "bukan perintah yang dikenali" });
  }

  const secret = await bridgeSecret();
  if (!secret) {
    console.error("[wa/webhook] integration_settings.vercel_bridge.secret belum diisi");
    return NextResponse.json({ ok: true, skipped: "bridge belum dikonfigurasi" });
  }

  let reply: string | null = null;

  if (unitCode) {
    const kodeUnit = unitCode[1].toUpperCase();
    const b = await callBridge("/bridge/dividend-proof-forward", { unit_code: kodeUnit, media_url: inbound.mediaUrl, sender: inbound.sender }, secret);
    if (!b) reply = `Gagal memproses bukti transfer unit ${kodeUnit}: server villa tidak bisa dihubungi.`;
    else if (b.success === true) reply = `Siap, bukti transfer sudah diteruskan ke ${b.investor_nama ?? "investor"} (unit ${kodeUnit}).`;
    else if (b.reason === "investor_tidak_ditemukan") reply = `Unit ${kodeUnit} tidak ditemukan atau investornya belum punya nomor HP terdaftar.`;
    else if (b.reason === "bukan_admin") reply = `Nomor ini belum terdaftar sebagai admin, jadi bukti transfer tidak diteruskan.`;
    else reply = `Bukti transfer unit ${kodeUnit} tidak terkirim (${b.reason ?? "sebab tidak diketahui"}).`;
  } else if (berhenti) {
    const body = await callBridge("/bridge/guest-opt-out", { hp: inbound.sender }, secret);
    reply =
      body?.success === true
        ? "Baik, kami tidak akan mengirimkan info promo lagi ke nomor ini. Terima kasih, dan pintu kami tetap terbuka kalau suatu saat ingin menginap lagi."
        : "Baik, permintaan Anda kami catat. Kalau masih menerima pesan dari kami, mohon balas sekali lagi ya.";
  } else if (lunas) {
    const kode = lunas[1].toUpperCase();
    const b = await callBridge("/bridge/confirm-payment", { code: kode, sender: inbound.sender }, secret);
    // Bukan nomor owner/admin: diam saja, pesannya tetap tercatat di Chat
    // seperti pesan biasa. Membalas "tidak berwenang" hanya memberi tahu
    // bahwa perintah semacam ini ada.
    if (b?.reason === "bukan_pengirim_berwenang") reply = null;
    else if (!b) reply = `Konfirmasi gagal: server villa tidak bisa dihubungi. Kode ${kode} belum diproses.`;
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
    const b = await callBridge("/bridge/promo-reject", { kode, sender: inbound.sender }, secret);
    reply = b?.reason === "bukan_pengirim_berwenang" ? null :
      b?.success === true
        ? `Baik, usulan promo ${kode} dibatalkan. Tidak ada pesan yang dikirim ke tamu.`
        : b?.reason === "sudah_terkirim"
          ? `Usulan ${kode} sudah terlanjur dikirim, jadi tidak bisa dibatalkan lagi.`
          : `Usulan ${kode} tidak ditemukan. Mohon cek lagi kodenya.`;
  } else if (promo) {
    const kode = promo[1].toUpperCase();
    const b = await callBridge("/bridge/promo-approve", { kode, sender: inbound.sender }, secret);
    if (b?.reason === "bukan_pengirim_berwenang") reply = null;
    else if (!b) reply = `Gagal memproses ${kode}: server villa tidak bisa dihubungi. Belum ada pesan yang dikirim ke tamu.`;
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
        batas_harian:
          `Batas kiriman promo hari ini sudah penuh (${b.terkirim_24_jam ?? "-"} dari ${b.maks_per_hari ?? "-"} pesan), ` +
          `jadi ${kode} belum dilanjutkan.\n\nMasih ada ${b.sisa ?? 0} tamu dalam antrean — balas PROMO ${kode} lagi besok. ` +
          `Batas ini yang menjaga nomor villa tidak diblokir WhatsApp.`,
        batas_harian_tidak_terbaca:
          `Jumlah kiriman hari ini tidak bisa dipastikan, jadi ${kode} saya hentikan dulu daripada berisiko mengirim melebihi batas. Tidak ada pesan yang dikirim.`,
        not_found: `Kode ${kode} tidak ditemukan.`,
        kedaluwarsa: `Usulan ${kode} sudah kedaluwarsa (lewat 48 jam), jadi tidak dikirim.`,
        ditolak: `Usulan ${kode} sudah ditolak sebelumnya.`,
        promo_tidak_aktif: `Promonya sudah tidak aktif, jadi ${kode} tidak dikirim.`,
      };
      reply = alasan[String(b.reason ?? "")] ?? `Kode ${kode} tidak bisa diproses.`;
    }
  }

  if (kolList || kolBatal || kolBuat) {
    reply = await jalankanPerintahKol(inbound.sender, { kolList, kolBatal, kolBuat }, secret);
  }

  if (reply) {
    const sent = await sendWhatsAppText(inbound.sender, reply);
    if (!sent.success) console.error("[wa/webhook] balasan gagal dikirim", sent.error);
    // Dicatat terlepas dari berhasil/tidaknya pengiriman -- resepsionis perlu
    // tahu APA yang seharusnya terkirim, termasuk saat pengirimannya gagal.
    if (percakapan) await catatBalasanOtomatisAman(supabaseAdmin(), percakapan.conversationId, reply);
  }

  // Selalu 200. WhaCenter tidak perlu tahu urusan internal kita, dan
  // status galat di sini bisa membuatnya mengulang kiriman yang sama.
  return NextResponse.json({ ok: true });
}
