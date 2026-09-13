import "server-only";

/**
 * Koneksi WhatsApp villa ke WhaCenter — jalur milik villa sendiri.
 *
 * Permintaan owner 2026-09-12/13: villa punya perangkat WhaCenter sendiri
 * supaya tidak perlu menumpang Mkhsistem hanya untuk mengirim WhatsApp.
 *
 * Kontrak WhaCenter-nya TIDAK dikarang di sini. Semuanya disalin dari
 * konektor Mkhsistem yang sudah berjalan bertahun-tahun melawan gateway
 * yang sama (lib/ai/connectors/whatsapp-connector.ts dan
 * whatsapp-http-client.ts), termasuk dua pelajaran mahal yang sudah
 * dibayar di sana dan tidak perlu dibayar dua kali:
 *
 *  1. Nomor disaring jadi angka saja sebelum dikirim. Pernah ada nomor
 *     karyawan yang mengandung karakter Unicode tak terlihat (U+202A/
 *     U+202C, sisa salin-tempel). WhaCenter tetap menjawab HTTP 200 untuk
 *     nomor rusak itu — ia menerima pekerjaannya tanpa memvalidasi nomor
 *     secara langsung — jadi kegagalannya senyap total: log bersih, pesan
 *     tidak pernah sampai.
 *  2. Percobaan ulang HANYA untuk galat jaringan yang dilempar (DNS,
 *     koneksi putus, timeout), TIDAK PERNAH untuk respons HTTP yang
 *     benar-benar dijawab WhaCenter. Balasan 4xx/5xx adalah keputusan API
 *     yang sah; mengulanginya bisa mengirim pesan yang sebenarnya sudah
 *     diantrekan — pesan dobel ke tamu.
 */

const DEFAULT_BASE_URL = "https://app.whacenter.com/api";
const REQUEST_TIMEOUT_MS = 15_000;

export interface WaSendResult {
  success: boolean;
  error?: string;
  attempts?: number;
}

export function whacenterDeviceId(): string {
  return (process.env.WHACENTER_DEVICE_ID ?? "").trim();
}

export function whacenterBaseUrl(): string {
  return (process.env.WHACENTER_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

export function isWhacenterConfigured(): boolean {
  return whacenterDeviceId().length > 0;
}

/** Disalin dari sanitizeRecipientNumber() Mkhsistem — lihat pelajaran (1) di atas. */
export function sanitizeNumber(recipient: string): string {
  return recipient.replace(/[^0-9]/g, "");
}

async function request(method: "GET" | "POST", path: string, body?: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${whacenterBaseUrl()}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const json: unknown = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Mengirim pesan teks. Body-nya rata: {device_id, number, message, file?}. */
export async function sendWhatsAppText(recipient: string, message: string, file?: string): Promise<WaSendResult> {
  const deviceId = whacenterDeviceId();
  if (!deviceId) return { success: false, error: "WHACENTER_DEVICE_ID belum diisi" };

  const number = sanitizeNumber(recipient);
  if (number.length < 8) return { success: false, error: `Nomor tidak punya angka yang cukup: "${recipient}"` };

  const body: Record<string, unknown> = { device_id: deviceId, number, message };
  if (file) body.file = file;

  const maxAttempts = 3;
  const retryDelaysMs = [1000, 3000];
  let lastError = "galat tidak dikenal";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await request("POST", "/send", body);
      // Respons HTTP apa pun mengakhiri percobaan — lihat pelajaran (2).
      if (res.ok) return { success: true, attempts: attempt };
      const msg = asRecord(res.json)?.message ?? asRecord(res.json)?.error;
      return { success: false, attempts: attempt, error: `WhaCenter menjawab ${res.status}: ${typeof msg === "string" ? msg : "tanpa keterangan"}` };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, retryDelaysMs[attempt - 1]));
    }
  }
  return { success: false, attempts: maxAttempts, error: `${lastError} (setelah ${maxAttempts} percobaan)` };
}

/** Status sesi perangkat. CONNECTED berarti HP yang dipasangkan siap mengirim. */
export async function deviceStatus(): Promise<{ ok: boolean; status?: string; error?: string }> {
  const deviceId = whacenterDeviceId();
  if (!deviceId) return { ok: false, error: "WHACENTER_DEVICE_ID belum diisi" };
  try {
    const res = await request("GET", `/statusDevice?device_id=${encodeURIComponent(deviceId)}`);
    const data = asRecord(res.json)?.data ?? res.json;
    const status = typeof asRecord(data)?.status === "string" ? String(asRecord(data)?.status) : undefined;
    return { ok: res.ok && status === "CONNECTED", status, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface NormalizedInbound {
  sender: string;
  senderName?: string;
  text: string;
}

/**
 * Membaca payload webhook masuk WhaCenter.
 *
 * Bentuk payload disalin dari normalizeIncomingMessage() Mkhsistem, yang
 * sudah terbukti terhadap payload asli: {pushName, from, to, message,
 * media, is_group, timestamp, source:"WHACENTER", ad_reply:{...}}.
 *
 * Villa hanya perlu teks: seluruh balasan yang dikenalinya (LUNAS, PROMO,
 * TOLAK, BERHENTI) berupa teks pendek. Lampiran sengaja diabaikan, bukan
 * ditebak-tebak bentuknya — bentuk media WhaCenter belum pernah
 * terverifikasi bahkan di Mkhsistem.
 *
 * Pesan grup dibuang: perintah seperti LUNAS tidak boleh bisa dipicu dari
 * dalam grup yang isinya bisa siapa saja.
 */
export function normalizeInbound(rawPayload: unknown): NormalizedInbound | null {
  const payload = asRecord(rawPayload);
  if (!payload) return null;
  if (payload.is_group === true) return null;

  const sender = payload.from;
  if (typeof sender !== "string" || sender.length === 0) return null;

  const text = typeof payload.message === "string" ? payload.message : "";
  if (text.trim().length === 0) return null;

  const pushName = typeof payload.pushName === "string" && payload.pushName.length > 0 ? payload.pushName : undefined;
  return { sender, senderName: pushName, text };
}

/**
 * Mendaftarkan URL webhook ke WhaCenter.
 *
 * Endpoint-nya terdokumentasi (`/setWebhook?device_id=...`) tapi NAMA
 * PARAMETER untuk URL-nya tidak bisa saya baca — halaman dokumentasinya
 * diblokir dari lingkungan tempat kode ini ditulis. Daripada menebak satu
 * nama lalu mengaku berhasil, fungsi ini mencoba beberapa nama yang masuk
 * akal lalu MEMBUKTIKAN hasilnya lewat getWebhook: yang dilaporkan sukses
 * hanya kalau WhaCenter benar-benar mengembalikan URL kita.
 *
 * Pola yang sama dipakai untuk menyelesaikan kontrak Cloudbeds yang juga
 * tidak terdokumentasi dengan benar (putRate, postReservation) pada
 * 2026-09-12.
 */
export async function setWebhookUrl(webhookUrl: string): Promise<{ success: boolean; cara?: string; tersimpan?: string; attempts: { cara: string; http: number }[]; mentah?: unknown; error?: string }> {
  const deviceId = whacenterDeviceId();
  if (!deviceId) return { success: false, attempts: [], error: "WHACENTER_DEVICE_ID belum diisi" };

  const namaParam = ["url", "webhook", "webhook_url", "urlwebhook"];
  const attempts: { cara: string; http: number }[] = [];

  // Percobaan pertama (POST + query string) dijawab HTTP 200 untuk KEEMPAT
  // nama parameter, tapi tidak satu pun benar-benar tersimpan. Itu bukan
  // keanehan baru: konektor Mkhsistem sudah mencatat bahwa WhaCenter
  // menjawab 200 untuk permintaan yang sebenarnya tidak ia kerjakan.
  //
  // Petunjuk yang saya lewatkan: contoh resmi WhaCenter memakai PHP
  // file_get_contents(), dan itu GET, bukan POST. Jadi urutannya sekarang
  // dimulai dari GET + query string, lalu turun ke bentuk lain.
  const cara: { nama: string; jalankan: () => Promise<{ status: number }> }[] = [];
  for (const p of namaParam) {
    const qs = `device_id=${encodeURIComponent(deviceId)}&${p}=${encodeURIComponent(webhookUrl)}`;
    cara.push({ nama: `GET ?${p}`, jalankan: () => request("GET", `/setWebhook?${qs}`) });
  }
  for (const p of namaParam) {
    cara.push({ nama: `POST body ${p}`, jalankan: () => request("POST", "/setWebhook", { device_id: deviceId, [p]: webhookUrl }) });
  }
  for (const p of namaParam) {
    cara.push({ nama: `POST form ${p}`, jalankan: () => requestForm("/setWebhook", { device_id: deviceId, [p]: webhookUrl }) });
  }

  for (const c of cara) {
    try {
      const res = await c.jalankan();
      attempts.push({ cara: c.nama, http: res.status });
      const tersimpan = await getWebhookUrl();
      if (tersimpan.url && tersimpan.url.trim() === webhookUrl.trim()) {
        return { success: true, cara: c.nama, tersimpan: tersimpan.url, attempts };
      }
    } catch {
      attempts.push({ cara: c.nama, http: 0 });
    }
  }

  // Jawaban getWebhook yang MENTAH ikut dikembalikan, bukan hasil olahan.
  // Pelajaran dari insiden getSources Cloudbeds 2026-09-12: saat itu yang
  // dicatat hanya proyeksi, sehingga kunci yang tidak ada berubah jadi {}
  // dan "tidak menjawab apa-apa" tidak bisa dibedakan dari "menjawab dengan
  // nama kunci yang berbeda" -- padahal justru itu dua kemungkinan yang
  // perlu dipisahkan.
  const akhir = await getWebhookUrl();
  return { success: false, attempts, tersimpan: akhir.url ?? undefined, mentah: akhir.mentah, error: "tidak ada cara yang terbukti tersimpan" };
}

/** Sebagian API PHP lama hanya menerima form-encoded, bukan JSON. */
async function requestForm(path: string, fields: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${whacenterBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    return { status: res.status, ok: res.ok, json: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

export async function getWebhookUrl(): Promise<{ url: string | null; mentah?: unknown; error?: string }> {
  const deviceId = whacenterDeviceId();
  if (!deviceId) return { url: null, error: "WHACENTER_DEVICE_ID belum diisi" };
  try {
    const res = await request("GET", `/getWebhook?device_id=${encodeURIComponent(deviceId)}`);
    const root = asRecord(res.json);
    const data = asRecord(root?.data) ?? root;

    // Nama kuncinya tidak terdokumentasi, jadi yang dicari BENTUKNYA --
    // string yang terlihat seperti URL -- bukan nama yang kebetulan saya
    // tebak benar.
    for (const k of ["webhook", "url", "webhook_url", "urlwebhook", "webhookUrl"]) {
      const v = data?.[k];
      if (typeof v === "string" && v.length > 0) return { url: v, mentah: res.json };
    }
    if (typeof root?.data === "string" && (root.data as string).length > 0) return { url: root.data as string, mentah: res.json };
    for (const v of Object.values(data ?? {})) {
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return { url: v, mentah: res.json };
    }
    return { url: null, mentah: res.json };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : String(e) };
  }
}
