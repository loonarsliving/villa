-- Kupon diskon investor 20% untuk Loonars Excellent Living (owner 2026-11-08).
--
-- Permintaan owner: promosi ke investor lama Loonars (Private Living) bersamaan
-- dengan pembukaan Excellent Living 12 Nov 2026. Aturan yang diputuskan owner:
--   - setiap investor Private Living memegang 5 kode, "terrefill terus":
--     begitu satu kode dipakai, kode baru menggantikannya (selalu ada 5);
--   - kode BOLEH disebar investor ke siapa saja ("bisa jd marketing jga");
--   - diskon 20%, hanya untuk pemesanan Excellent Living di loonars.id
--     (kolom kode referral di form pemesanan EL);
--   - diskon MENGURANGI pendapatan Excellent Living (tarif booking = harga
--     setelah diskon);
--   - Private Living tidak ikut (investor sudah punya menginap gratis);
--   - Coffee & Beauty TIDAK memakai kode ini -- investor menunjukkan Kartu
--     Priority Investor di kasir (tampilan saja, tidak ada tabel).
--
-- Satu kode = satu booking, selamanya (unique index pada bookings, sama
-- seperti voucher menginap gratis investor). Booking yang batal / kedaluwarsa
-- TETAP menghabiskan kodenya: booking kedaluwarsa masih bisa hidup kembali
-- kalau pembayarannya masuk terlambat, dan kode yang sudah dipakai ulang akan
-- membuat booking yang sudah dibayar itu gagal dihidupkan. Karena kode diisi
-- ulang otomatis, kode yang "terbuang" tidak merugikan investor.
--
-- Status kode TIDAK disimpan: "terpakai" = ada booking yang menunjuknya.

create table if not exists public.villa_investor_kupon (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.villa_users(id) on delete cascade,
  kode          text not null unique check (kode ~ '^INV-[A-Z0-9]{6}$'),
  diskon_persen numeric not null default 20 check (diskon_persen > 0 and diskon_persen <= 50),
  aktif         boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists villa_investor_kupon_user_idx on public.villa_investor_kupon(user_id, created_at);

alter table public.villa_investor_kupon enable row level security;
revoke all on public.villa_investor_kupon from anon, authenticated;
create policy srole_villa_investor_kupon on public.villa_investor_kupon for all to service_role using (true) with check (true);

-- Penanda pada booking + nominal diskon (rupiah) yang diberikan saat itu,
-- disimpan supaya laporan tidak menghitung ulang dari persen yang bisa berubah.
alter table public.bookings
  add column if not exists investor_kupon_id uuid references public.villa_investor_kupon(id) on delete restrict,
  add column if not exists diskon_kupon numeric check (diskon_kupon is null or diskon_kupon >= 0);

create unique index if not exists bookings_investor_kupon_sekali_pakai
  on public.bookings(investor_kupon_id) where investor_kupon_id is not null;

comment on table public.villa_investor_kupon is
  'Kupon diskon 20% Excellent Living milik investor Private Living. 5 kode per investor, diisi ulang otomatis oleh villa-api (GET /investor/kupon). Dipakai lewat kolom kode referral form EL di loonars.id; diskon mengurangi tarif (pendapatan) EL.';
