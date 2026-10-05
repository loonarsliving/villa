-- Draf balasan AI di Chat resepsionis (owner request 2026-10-05, tahap 1: draf saja).
-- BELUM diterapkan -- menunggu persetujuan owner atas perubahan skema.
-- Hanya menambah kolom nullable; tidak ada data yang diubah atau dihapus.

alter table public.wa_conversations add column if not exists ai_draf text;
alter table public.wa_conversations add column if not exists ai_kategori text;
alter table public.wa_conversations add column if not exists ai_alasan text;
alter table public.wa_conversations add column if not exists ai_draf_untuk_pesan uuid
  references public.wa_conversation_messages(id) on delete set null;
alter table public.wa_conversations add column if not exists ai_draf_at timestamptz;

comment on column public.wa_conversations.ai_draf is
  'Draf balasan AI untuk pesan tamu terakhir. TIDAK pernah terkirim sendiri: resepsionis memakainya lewat halaman Chat. null = tidak ada draf.';
comment on column public.wa_conversations.ai_kategori is
  'jawab | cek_tanggal | booking | paket_rebecca | komplain | perlu_resepsionis -- siapa yang seharusnya menangani pesan ini.';
comment on column public.wa_conversations.ai_alasan is
  'Dari mana jawaban draf diambil, atau kenapa draf ditahan (mis. menyebut angka yang tidak ada di data).';
comment on column public.wa_conversations.ai_draf_untuk_pesan is
  'Pesan masuk yang dijawab draf ini. Draf dianggap basi begitu ada pesan masuk lain atau balasan staf sesudahnya.';
