-- Terjemahan dua arah di Chat resepsionis (owner-approved 2026-09-28).
-- Diterapkan ke produksi lewat Supabase MCP (apply_migration "wa_chat_terjemahan").
-- Hanya menambah kolom nullable; tidak ada data yang diubah atau dihapus.

alter table public.wa_conversations add column if not exists bahasa text;
alter table public.wa_conversation_messages add column if not exists terjemahan text;

comment on column public.wa_conversations.bahasa is
  'Bahasa tamu (kode ISO 639-1, mis. en, zh, id). null = belum diketahui. Dipakai untuk menerjemahkan balasan resepsionis ke bahasa tamu.';
comment on column public.wa_conversation_messages.terjemahan is
  'Pesan masuk: terjemahan Indonesia dari isi (bahasa asing). Pesan keluar: teks Indonesia asli yang ditulis resepsionis, sedangkan isi = versi yang benar-benar dikirim ke tamu. null = tidak diterjemahkan.';
