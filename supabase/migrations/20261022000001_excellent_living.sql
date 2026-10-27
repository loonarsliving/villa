-- Loonars Excellent Living (Loonars 2, Jogja): properti KEDUA di aplikasi
-- villa, dengan tabelnya sendiri -- terpisah total dari Loonars Private
-- Living (owner 2026-10-22: "Saya ingin dia benar2 tabel baru yg lain dari
-- loonars private living").
--
-- Keputusan owner (2026-10-22):
--   * Investor EL dan resepsionis EL = akun & role BARU, berbeda dari
--     investor/resepsionis Private Living. Admin dan finance tetap akun yang
--     sama, hanya mendapat menu tambahan.
--   * 31 kamar: 14 Single/Twin Room, 12 Sanctuary Pool, 5 Family Private
--     Pool. Diisi placeholder (ST-01.., SP-01.., FP-01..) yang bisa diubah
--     admin -- nama, tipe, dan status.
--   * Data investor diambil dari Mkhsistem (proyek LNR2 di loonars_units /
--     loonars_unit_purchases -- database yang sama). Tabel di sini hanya
--     menautkan akun investor ke unit LNR2-nya, tidak menyalin datanya.
--   * Rumus bagi hasil investor EL BELUM ditentukan ("Nanti saja kt setting
--     tentang ini"). Karena itu tidak ada kolom/tabel dividen di sini.
--
-- Sengaja TIDAK menyentuh units/bookings/cloudbeds_room_mapping milik
-- Private Living, sehingga laporan, dividen, okupansi, dan harga AI Private
-- Living tidak bisa ikut terhitung kamar EL.
--
-- Semua tabel: RLS ON tanpa policy + revoke anon/authenticated (konvensi
-- 20260806070012 / 20260908000001) -- hanya villa-api dan rute server
-- (service role) yang membaca/menulis.

-- 1. Role baru ------------------------------------------------------------
alter table public.villa_users drop constraint villa_users_role_check;
alter table public.villa_users add constraint villa_users_role_check check (role = any (array[
  'owner', 'receptionist', 'admin', 'security', 'cleaning_service', 'finance', 'manager', 'late_night',
  'el_investor', 'el_receptionist'
]));

-- 2. Tipe kamar ------------------------------------------------------------
create table if not exists public.el_room_types (
  id          uuid primary key default gen_random_uuid(),
  kode        text not null unique,
  nama        text not null,
  deskripsi   text,
  kapasitas   int check (kapasitas between 1 and 20),
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.el_room_types (kode, nama, sort_order) values
  ('ST', 'Single / Twin Room', 1),
  ('SP', 'Sanctuary Pool', 2),
  ('FP', 'Family Private Pool', 3)
on conflict (kode) do nothing;

-- 3. Kamar -------------------------------------------------------------------
create table if not exists public.el_rooms (
  id            uuid primary key default gen_random_uuid(),
  nomor         text not null unique,
  room_type_id  uuid not null references public.el_room_types(id),
  status        text not null default 'available'
                check (status in ('available', 'occupied', 'dirty', 'maintenance')),
  catatan       text,
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.el_rooms (nomor, room_type_id, sort_order)
select t.kode || '-' || lpad(n::text, 2, '0'), t.id, t.sort_order * 100 + n
from public.el_room_types t
cross join lateral generate_series(1, case t.kode when 'ST' then 14 when 'SP' then 12 when 'FP' then 5 end) as n
where t.kode in ('ST', 'SP', 'FP')
on conflict (nomor) do nothing;

-- 4. Booking -----------------------------------------------------------------
-- Satu kamar dari tgl_checkin sampai SEBELUM tgl_checkout. Bentrok tanggal
-- dicegah di villa-api (sama seperti bookings Private Living).
create table if not exists public.el_bookings (
  id                        uuid primary key default gen_random_uuid(),
  room_id                   uuid references public.el_rooms(id),
  room_nomor                text,
  guest_nama                text not null,
  guest_hp                  text,
  sumber                    text not null default 'walk-in'
                            check (sumber in ('walk-in', 'whatsapp', 'website', 'cloudbeds', 'airbnb', 'agoda',
                                              'booking.com', 'tiket', 'traveloka', 'google', 'other')),
  status                    text not null default 'terjadwal'
                            check (status in ('terjadwal', 'checkin', 'checkout', 'batal')),
  tgl_checkin               date not null,
  tgl_checkout              date not null,
  durasi_malam              int,
  adults                    int not null default 1 check (adults between 1 and 20),
  children                  int not null default 0 check (children between 0 and 20),
  total_bayar               numeric not null default 0 check (total_bayar >= 0),
  catatan                   text,
  cloudbeds_reservation_id  text unique,
  dibuat_oleh               text,
  checkin_at                timestamptz,
  checkin_by                text,
  checkout_at               timestamptz,
  checkout_by               text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (tgl_checkout > tgl_checkin)
);

create index if not exists el_bookings_tanggal_idx on public.el_bookings (tgl_checkin, tgl_checkout);
create index if not exists el_bookings_room_idx on public.el_bookings (room_id, tgl_checkin);

-- 5. Cloudbeds (akun kedua) --------------------------------------------------
create table if not exists public.el_cloudbeds_room_mapping (
  id                   uuid primary key default gen_random_uuid(),
  cloudbeds_room_id    text not null unique,
  cloudbeds_room_name  text,
  room_id              uuid not null references public.el_rooms(id) on delete cascade,
  created_at           timestamptz not null default now()
);

create table if not exists public.el_cloudbeds_events_log (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  text,
  event_type      text,
  payload         jsonb not null default '{}'::jsonb,
  matched         boolean not null default false,
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists el_cloudbeds_events_log_res_idx on public.el_cloudbeds_events_log (reservation_id, event_type, created_at desc);

-- 6. Investor EL -> unit LNR2 di Mkhsistem ----------------------------------
-- Ditautkan manual oleh admin (bukan dicocokkan otomatis lewat nama/HP
-- pembeli, yang bisa salah orang).
create table if not exists public.el_investor_units (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.villa_users(id) on delete cascade,
  loonars_unit_id  uuid not null references public.loonars_units(id) on delete restrict,
  created_by       text,
  created_at       timestamptz not null default now(),
  unique (user_id, loonars_unit_id)
);

-- 7. RLS: service role saja --------------------------------------------------
alter table public.el_room_types enable row level security;
alter table public.el_rooms enable row level security;
alter table public.el_bookings enable row level security;
alter table public.el_cloudbeds_room_mapping enable row level security;
alter table public.el_cloudbeds_events_log enable row level security;
alter table public.el_investor_units enable row level security;
revoke all on public.el_room_types, public.el_rooms, public.el_bookings, public.el_cloudbeds_room_mapping,
  public.el_cloudbeds_events_log, public.el_investor_units from anon, authenticated;
