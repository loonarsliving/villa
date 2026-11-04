-- Multi-properti: chat WhatsApp tamu per properti (owner 2026-11-04: "wa
-- tamu pakai wa yg sama buat keunikan sj kapan wa harus masuk di excellent
-- kapan masuk di pl").
--
-- Satu nomor WA villa, satu percakapan per nomor tamu (wa_conversations.phone
-- unik). Kolom property_kode menandai percakapan itu milik properti mana;
-- ditentukan src/lib/waChat.ts setiap pesan masuk: menyebut "Excellent" ->
-- EL; booking aktif EL (tanpa booking aktif PL) -> EL; booking aktif PL
-- (tanpa EL) -> PL; selain itu tetap seperti sebelumnya (baru = PL).
-- Halaman Chat menampilkan percakapan sesuai properti penggunanya.
-- Semua percakapan lama = 'PL'.

alter table public.wa_conversations
  add column if not exists property_kode text not null default 'PL' references public.villa_properties(kode);
create index if not exists wa_conversations_property_kode_idx on public.wa_conversations (property_kode);

notify pgrst, 'reload schema';
