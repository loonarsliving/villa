import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bacaGambarDataUrl, tautanGambarChat } from "./chatGambarFormat";

/**
 * Gambar yang dikirim staf dari halaman Chat (owner 2026-10-23). Disimpan di
 * bucket privat `guest-documents` (folder chat/), lalu dibuka lewat
 * /api/chat/gambar/<id percakapan>/<uuid>.<ext> di domain villa sendiri.
 *
 * Kenapa bukan tautan bertanda tangan Supabase: WhaCenter menjawab 500
 * untuk tautan ber-?token= (2026-10-24, dua kiriman Rebecca gagal), sedangkan
 * semua kiriman file yang berhasil memakai tautan tanpa query. Nama file
 * acak (UUID) di folder percakapan membuat tautannya tidak bisa ditebak, dan
 * rute itu hanya melayani folder chat/ -- foto KTP di bucket yang sama tidak
 * terjangkau.
 */
const BUCKET = "guest-documents";

export async function simpanGambarChat(
  supabase: SupabaseClient,
  conversationId: string,
  dataUrl: string,
): Promise<{ url: string } | { error: string }> {
  const gambar = bacaGambarDataUrl(dataUrl);
  if ("error" in gambar) return gambar;

  const file = `${crypto.randomUUID()}.${gambar.ext}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(`chat/${conversationId}/${file}`, gambar.bytes, {
    contentType: gambar.contentType,
    upsert: false,
  });
  if (uploadError) return { error: `Gambar gagal disimpan: ${uploadError.message}` };

  return { url: tautanGambarChat(conversationId, file) };
}

/** Isi gambar untuk rute /api/chat/gambar -- null kalau tidak ada. */
export async function ambilGambarChat(
  supabase: SupabaseClient,
  conversationId: string,
  file: string,
): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(`chat/${conversationId}/${file}`);
  return error || !data ? null : data;
}
