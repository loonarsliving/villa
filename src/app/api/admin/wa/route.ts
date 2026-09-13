import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { deviceStatus, getWebhookUrl, setWebhookUrl, isWhacenterConfigured, whacenterBaseUrl } from "@/lib/whacenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pemeriksaan dan pendaftaran webhook WhaCenter.
 *
 * GET  -> status perangkat + URL webhook yang sekarang tersimpan
 * POST -> daftarkan URL webhook villa ke WhaCenter, lalu buktikan
 *
 * Ada di sini, bukan dijalankan dari laptop siapa pun, karena app.whacenter.com
 * tidak bisa dijangkau dari lingkungan tempat kode ini ditulis — tapi bisa
 * dari Vercel. Dijaga rahasia cron yang sama dengan pekerjaan terjadwal
 * lain; bukan mekanisme baru.
 *
 * URL webhook-nya TIDAK diketik manual: diturunkan dari host permintaan ini
 * sendiri. Satu alamat yang salah ketik di sini berarti seluruh balasan
 * owner hilang tanpa jejak.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isWhacenterConfigured()) {
    return NextResponse.json({ error: "WHACENTER_DEVICE_ID belum diisi di Vercel" }, { status: 503 });
  }
  const [status, webhook] = await Promise.all([deviceStatus(), getWebhookUrl()]);
  return NextResponse.json({
    base_url: whacenterBaseUrl(),
    perangkat: status,
    webhook_tersimpan: webhook.url,
    // Jawaban mentah ikut ditampilkan, bukan cuma hasil olahan: kalau nama
    // kuncinya ternyata lain, ini satu-satunya cara mengetahuinya.
    getwebhook_mentah: webhook.mentah,
    webhook_seharusnya: new URL("/api/wa/webhook", request.url).toString(),
  });
}

export async function POST(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isWhacenterConfigured()) {
    return NextResponse.json({ error: "WHACENTER_DEVICE_ID belum diisi di Vercel" }, { status: 503 });
  }

  const target = new URL("/api/wa/webhook", request.url).toString();
  const hasil = await setWebhookUrl(target);
  return NextResponse.json({ ...hasil, webhook_didaftarkan: target }, { status: hasil.success ? 200 : 502 });
}
