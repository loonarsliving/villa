-- Kupon menginap gratis untuk barter KOL (diminta & disetujui owner 2026-10-09).
--
-- Owner: "kupon nginap gratis yg bisa saya isi jga di loonars.id ... untuk
-- barter KOL yg ingin mnginap dan barter dgan konten", dibuat lewat WA ke
-- sistem ("KOL @akun <malam>"). Aturan yang disetujui:
--   - jumlah malam gratis ditentukan per kupon;
--   - boleh weekend dan high season (owner yang memilih siapa yang dapat);
--   - semua tipe kamar, TETAP hanya kalau ada unit kosong (jalur booking biasa);
--   - menginap lebih lama dari jatahnya: malam sisanya dibayar normal (QRIS);
--   - sekali pakai; berlaku 3 bulan sejak dibuat.
--
-- Tidak memakai villa_investor_vouchers karena voucher itu melekat pada unit
-- dan bulan tertentu (unique unit_id+periode) -- bentuk yang berbeda sama
-- sekali. Tidak memakai villa_promos karena promo sengaja dijepit di atas
-- harga minimum kamar dan tidak pernah bisa Rp 0.

create table if not exists public.villa_kol_vouchers (
  id             uuid primary key default gen_random_uuid(),
  kode           text not null unique check (kode ~ '^KOL-[A-Z0-9]{6}$'),
  untuk          text not null,              -- nama / akun IG KOL, apa adanya dari owner
  malam_gratis   int  not null check (malam_gratis between 1 and 7),
  berlaku_sampai date not null,
  aktif          boolean not null default true,
  catatan        text,
  dibuat_lewat   text not null default 'wa',
  created_at     timestamptz not null default now()
);

alter table public.villa_kol_vouchers enable row level security;
revoke all on public.villa_kol_vouchers from anon, authenticated;

alter table public.bookings
  add column if not exists kol_voucher_id uuid references public.villa_kol_vouchers(id) on delete restrict;

-- Sekali pakai, dijaga database (dua permintaan kembar sama-sama lolos
-- pemeriksaan aplikasi). Booking yang batal tidak menghabiskan kuponnya.
create unique index if not exists bookings_kol_voucher_sekali_pakai
  on public.bookings(kol_voucher_id) where kol_voucher_id is not null and status <> 'batal';

-- Malam gratis harus selalu bisa ditelusuri ke kuponnya: investor ATAU KOL.
alter table public.bookings drop constraint if exists bookings_free_stay_konsisten;
alter table public.bookings add constraint bookings_free_stay_konsisten
  check (not is_free_stay or voucher_id is not null or kol_voucher_id is not null);

-- Sumber booking baru. Daftar lama dibaca langsung dari database 2026-10-09.
alter table public.bookings drop constraint if exists bookings_sumber_check;
alter table public.bookings add constraint bookings_sumber_check
  check (sumber = any (array['walk-in','airbnb','tiket','agoda','booking.com','website','whatsapp','other','cloudbeds','traveloka','google','late-night','investor','kol']));

comment on table public.villa_kol_vouchers is
  'Kupon menginap gratis untuk barter KOL. Dibuat owner lewat WA (KOL @akun <malam>). Booking-nya bersumber ''kol''; yang seluruhnya gratis ditandai is_free_stay sehingga dikecualikan dari pendapatan, dividen, dan okupansi seperti malam gratis investor.';
