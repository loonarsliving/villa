-- Voucher menginap gratis investor.
--
-- Aturan main dari owner (12 Sep 2026), dicatat di ROADMAP.md:
--   13 investor aktif x 12 kode = 156 kode, satu kode per bulan kalender,
--   Okt 2026 s/d Sep 2027. Kode hangus kalau bulannya lewat. Tidak boleh
--   dipakai Jumat/Sabtu/Minggu, dan tidak boleh di high season (dua
--   larangan TERPISAH, bukan "weekend yang jatuh di high season").
--   Menginapnya tetap didorong ke Cloudbeds supaya OTA berhenti menjual
--   unitnya, tapi TIDAK masuk laporan keuangan, rumus dividen, maupun
--   hitungan okupansi yang dipakai AI dan promo.
--
-- Yang membuat rancangan ini aman ada di dua tempat, bukan di kode aplikasi:
--   1. unique (user_id, periode) -- "sebulan sekali" tidak bisa dilanggar
--      meski ada dua permintaan datang bersamaan.
--   2. unique index pada bookings.voucher_id -- satu kode hanya bisa
--      menempel pada SATU booking, selamanya. Tidak ada pengecekan "sudah
--      dipakai?" di aplikasi yang bisa kalah balapan dengan dirinya sendiri.
--
-- Status voucher sengaja TIDAK disimpan sebagai kolom. "Terpakai" dibaca
-- dari ada/tidaknya booking yang menunjuk voucher itu, dan "hangus" dihitung
-- dari periode terhadap tanggal hari ini. Kolom status akan jadi salinan
-- kedua dari kebenaran yang sama, dan salinan kedua selalu berakhir
-- berbeda dari yang pertama.

create table if not exists public.villa_investor_vouchers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.villa_users(id) on delete cascade,
  kode        text not null,
  periode     date not null,
  created_at  timestamptz not null default now(),
  constraint villa_investor_vouchers_kode_unik unique (kode),
  constraint villa_investor_vouchers_satu_per_bulan unique (user_id, periode),
  constraint villa_investor_vouchers_periode_awal_bulan check (extract(day from periode) = 1),
  constraint villa_investor_vouchers_kode_bentuk check (kode ~ '^[A-Z0-9]{8}$')
);

create index if not exists villa_investor_vouchers_user_idx on public.villa_investor_vouchers(user_id, periode);

alter table public.villa_investor_vouchers enable row level security;
revoke all on public.villa_investor_vouchers from anon, authenticated;

-- Penanda pada booking. INI yang disaring di sebelas tempat penghitung
-- okupansi; tanpa kolom di bookings, setiap kueri harus di-join sendiri dan
-- satu yang terlewat menghasilkan angka berbeda tanpa pesan galat.
alter table public.bookings
  add column if not exists voucher_id uuid references public.villa_investor_vouchers(id) on delete restrict,
  add column if not exists is_free_stay boolean not null default false;

create unique index if not exists bookings_voucher_sekali_pakai
  on public.bookings(voucher_id) where voucher_id is not null;

-- Penandanya tidak boleh bisa lepas dari vouchernya. Booking gratis tanpa
-- voucher berarti ada malam yang hilang dari pendapatan tanpa alasan yang
-- bisa ditelusuri; voucher tanpa penanda berarti malam gratis diam-diam ikut
-- terhitung sebagai pendapatan dan okupansi.
-- Voucher menggratiskan SATU malam; menginapnya boleh lebih lama, dan malam
-- sisanya dibayar penuh. Booking seperti itu BUKAN malam gratis -- pendapatan
-- malam keduanya nyata dan harus ikut terhitung. Jadi hubungannya "kalau
-- gratis, pasti ada vouchernya", bukan "sama dengan".
alter table public.bookings drop constraint if exists bookings_free_stay_konsisten;
alter table public.bookings add constraint bookings_free_stay_konsisten
  check (not is_free_stay or voucher_id is not null);

comment on column public.bookings.is_free_stay is
  'Malam gratis investor (voucher). Dikecualikan dari laporan keuangan, rumus dividen, dan okupansi yang dipakai AI/promo -- TAPI tetap tampil terisi di kartu front desk dan tetap didorong ke Cloudbeds.';
