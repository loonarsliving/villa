import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bacaGambarDataUrl } from "./chatGambarFormat";

/**
 * Gambar yang dikirim staf dari halaman Chat (owner 2026-10-23). Disimpan di
 * bucket privat `guest-documents` (folder chat/), lalu dibuatkan tautan
 * bertanda tangan: WhaCenter mengunduh gambar dari tautan itu untuk dikirim
 * ke tamu, dan tautan yang sama disimpan di media_url supaya gambar tampil di
 * riwayat chat. Bucket tetap privat -- hanya yang memegang tautan yang bisa
 * membukanya, sama seperti lampiran WhaCenter dari tamu.
 */
const BUCKET = "guest-documents";
const MASA_TAUTAN_DETIK = 365 * 24 * 60 * 60;

export async function simpanGambarChat(
  supabase: SupabaseClient,
  conversationId: string,
  dataUrl: string,
): Promise<{ url: string } | { error: string }> {
  const gambar = bacaGambarDataUrl(dataUrl);
  if ("error" in gambar) return gambar;

  const path = `chat/${conversationId}/${crypto.randomUUID()}.${gambar.ext}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, gambar.bytes, {
    contentType: gambar.contentType,
    upsert: false,
  });
  if (uploadError) return { error: `Gambar gagal disimpan: ${uploadError.message}` };

  const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(path, MASA_TAUTAN_DETIK);
  if (signError || !data?.signedUrl) return { error: `Tautan gambar gagal dibuat: ${signError?.message ?? "tanpa keterangan"}` };
  return { url: data.signedUrl };
}
