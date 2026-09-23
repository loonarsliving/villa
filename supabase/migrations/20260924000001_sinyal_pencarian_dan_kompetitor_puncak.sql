-- Dua sumber data baru untuk mesin harga AI (owner-approved 2026-09-24).
-- Keduanya aditif: tabel baru dan satu kolom nullable. Tidak ada data lama
-- yang berubah, dan tidak ada harga yang bergerak hanya karena migrasi ini.

-- 1. Pencarian ketersediaan di website (loonars.id -> villa-api
--    GET /public/availability).
--
-- Hotel besar (Duetto dan sejenisnya) membaca permintaan bukan hanya dari
-- booking yang jadi, tapi juga dari orang yang MENCARI tanggal itu. Orang
-- yang mencari 31 Des lalu tidak memesan tetap bukti ada minat pada tanggal
-- itu -- dan itu terlihat berminggu-minggu sebelum okupansi bergerak.
--
-- Sengaja TIDAK menyimpan data pribadi: tidak ada IP, nama, nomor, atau
-- email. session_id adalah angka acak dari browser (localStorage) hanya
-- supaya satu orang yang mengklik "cek" lima kali dihitung satu orang.
create table if not exists public.villa_availability_searches (
  id bigserial primary key,
  searched_at timestamptz not null default now(),
  checkin date not null,
  checkout date not null,
  -- filter tipe unit yang diminta; null = semua tipe
  room_type text,
  session_id text,
  -- tipe unit yang HABIS untuk tanggal itu saat dicari (permintaan yang ditolak)
  sold_out_types text[] not null default '{}',
  source text not null default 'website',
  constraint villa_availability_searches_tanggal_urut check (checkout > checkin)
);

create index if not exists villa_availability_searches_checkin_idx
  on public.villa_availability_searches (checkin);
create index if not exists villa_availability_searches_searched_at_idx
  on public.villa_availability_searches (searched_at);

-- Konvensi proyek (20260806070012_enable_rls_villa_service_role_only):
-- RLS aktif tanpa policy = hanya service role (villa-api, cron) yang bisa
-- membaca/menulis. Tanpa baris ini anon key publik bisa membaca tabelnya.
alter table public.villa_availability_searches enable row level security;

-- 2. Harga kompetitor untuk MALAM TERTENTU (tanggal puncak).
--
-- villa_competitor_rates selama ini hanya berisi harga malam biasa, jadi
-- mesin harga sengaja tidak memakainya pada tanggal puncak (membandingkan
-- harga malam tahun baru dengan harga malam biasa tetangga itu keliru).
-- stay_date null = harga malam biasa (semua baris lama); terisi = harga
-- yang ditemukan untuk menginap malam itu.
alter table public.villa_competitor_rates
  add column if not exists stay_date date;

create index if not exists villa_competitor_rates_stay_date_idx
  on public.villa_competitor_rates (room_type_id, stay_date)
  where stay_date is not null;
