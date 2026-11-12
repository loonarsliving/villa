-- Chat Front Desk: tutup sesi chat (owner 2026-11-12: "sediakan fitur tutup
-- sesi chat, agar jika setelah chat tamu selesai dengan keluhannya bisa
-- ditutup sesi itu jadi tidak ada sesi yang menggantung").
--
-- ditutup_at / ditutup_oleh: diisi saat staf menekan "Tutup sesi" (rute
-- POST /api/chat/conversations/[id]/tutup), yang sekaligus mengosongkan
-- unread_count. Sesi terbuka lagi otomatis saat tamu mengirim pesan baru
-- (RPC di bawah, atomik bersama kenaikan unread) atau saat staf membalas.
-- Hanya kolom nullable baru: percakapan lama = sesi terbuka.

alter table public.wa_conversations
  add column if not exists ditutup_at timestamptz,
  add column if not exists ditutup_oleh text;

-- Isi sama dengan versi live, ditambah membuka kembali sesi yang ditutup.
create or replace function public.wa_conversation_increment_unread(p_conversation_id uuid, p_preview text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update wa_conversations
  set unread_count = unread_count + 1,
      last_message_at = now(),
      last_message_preview = p_preview,
      ditutup_at = null,
      ditutup_oleh = null
  where id = p_conversation_id;
$function$;

notify pgrst, 'reload schema';
