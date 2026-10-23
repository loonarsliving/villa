-- Langganan notifikasi push (Web Push) untuk aplikasi villa.
-- Disetujui owner 2026-10-23 ("Ya, setujui keduanya") untuk notifikasi chat
-- tamu ke manager (Rebecca): push ke HP/iPhone layar utama, termasuk angka
-- belum-dibaca di ikon aplikasi.
--
-- Satu baris = satu perangkat/browser yang mengizinkan notifikasi. Disimpan
-- per PERAN (villa-api /manager/whoami hanya mengembalikan role, bukan id
-- akun), dan pengirim memilih peran penerima -- saat ini hanya 'manager'.
--
-- Aditif: tabel baru, tidak menyentuh data lain. Tidak berisi data uang
-- atau data tamu. RLS aktif TANPA policy = hanya service role (rute Next.js
-- villa), sama seperti pola 20260806070012_enable_rls_villa_service_role_only.

create table if not exists public.villa_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists villa_push_subscriptions_role_idx on public.villa_push_subscriptions (role);

alter table public.villa_push_subscriptions enable row level security;

comment on table public.villa_push_subscriptions is
  'Web Push subscription per perangkat aplikasi villa (per peran). Service role saja. Dipakai untuk notifikasi chat tamu ke manager.';
