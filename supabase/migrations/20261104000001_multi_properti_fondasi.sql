-- Multi-properti, Tahap 1: fondasi (owner 2026-11-03/04).
--
-- Owner memilih "B: satu sistem multi-properti" untuk Loonars Private Living
-- (PL) dan Loonars Excellent Living (EL), lalu: "betul buat sj pgaman, dan
-- jgan sampai menggangu private living yg sedang berjalan".
-- Rencana lengkap: docs/multi-properti/RENCANA.md.
--
-- Aditif dan tidak mengubah angka apa pun:
--   * tabel baru villa_properties (PL, EL);
--   * kolom property_kode NOT NULL DEFAULT 'PL' di tabel inti yang dibaca
--     rumus uang PL. Semua baris yang ada otomatis 'PL', dan insert lama yang
--     tidak menyebut kolom ini tetap jadi 'PL';
--   * villa_users.property_kode (NULL = semua properti) untuk manager dan
--     resepsionis per properti nanti.
--
-- Pengamannya ada di kode (villa-api klienProperti, src/lib/klienProperti.ts):
-- koneksi database sistem villa hanya membaca/menulis baris properti 'PL'
-- di tabel-tabel ini. Karena semua baris saat ini 'PL', hasilnya identik.
-- Data EL BELUM dipindah ke sini (Tahap 4), dan sebelum itu fungsi database
-- Mkhsistem yang membaca units/bookings (mkc_hosp_*, mkc_mkt_*) juga harus
-- disaring.
--
-- Menambah kolom dengan DEFAULT konstanta di Postgres 11+ tidak menulis
-- ulang tabel.

create table if not exists public.villa_properties (
  kode text primary key check (kode ~ '^[A-Z]{2,6}$'),
  nama text not null,
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.villa_properties enable row level security;

insert into public.villa_properties (kode, nama) values
  ('PL', 'Loonars Private Living'),
  ('EL', 'Loonars Excellent Living')
on conflict (kode) do nothing;

do $$
declare
  t text;
begin
  foreach t in array array[
    'units',
    'villa_room_types',
    'bookings',
    'transactions',
    'finance_settlements',
    'cloudbeds_room_mapping',
    'villa_daily_inventory_snapshot'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'property_kode'
    ) then
      execute format(
        'alter table public.%I add column property_kode text not null default %L references public.villa_properties(kode)',
        t, 'PL'
      );
    end if;
    execute format('create index if not exists %I on public.%I (property_kode)', t || '_property_kode_idx', t);
  end loop;
end $$;

alter table public.villa_users
  add column if not exists property_kode text references public.villa_properties(kode);

comment on column public.bookings.property_kode is
  'Properti pemilik baris (PL/EL). Rumus uang PL hanya membaca PL lewat klienProperti; lihat docs/multi-properti/RENCANA.md.';
comment on column public.villa_users.property_kode is
  'NULL = semua properti (admin, finance). Diisi untuk manager/resepsionis yang hanya mengurus satu properti.';

-- PostgREST harus langsung mengenali kolom baru sebelum villa-api yang
-- menyaring property_kode di-deploy.
notify pgrst, 'reload schema';
