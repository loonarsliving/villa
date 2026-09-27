import "server-only";

/**
 * Kirim WhatsApp dari nomor utama 082228885223 -- perangkat WhaCenter yang
 * dipegang Mkhsistem, bukan perangkat villa sendiri (lihat src/lib/whacenter.ts).
 * Lewat /api/wa/send Mkhsistem yang sudah ada: body {phone, message},
 * header x-internal-secret (VILLA_BRIDGE_SECRET, nilainya sama di kedua sisi).
 *
 * Sengaja tanpa percobaan ulang: kalau Mkhsistem sudah meneruskan ke
 * WhaCenter lalu jawabannya hilang di jalan, mengulang = pesan dobel ke tamu.
 */
const MKHSISTEM_WA_SEND_URL = "https://mkh.haluoleo.id/api/wa/send";
const TIMEOUT_MS = 20_000;

export async function kirimDariNomorUtama(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  const secret = (process.env.VILLA_BRIDGE_SECRET ?? "").trim();
  if (!secret) return { success: false, error: "VILLA_BRIDGE_SECRET belum diisi" };

  try {
    const res = await fetch(MKHSISTEM_WA_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ phone, message }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as { success?: unknown; error?: unknown } | null;
    if (res.ok && json?.success === true) return { success: true };
    const alasan = typeof json?.error === "string" ? json.error : "tanpa keterangan";
    return { success: false, error: `Mkhsistem menjawab ${res.status}: ${alasan}` };
  } catch (e) {
    return { success: false, error: `Mkhsistem tidak bisa dihubungi: ${e instanceof Error ? e.message : String(e)}` };
  }
}
