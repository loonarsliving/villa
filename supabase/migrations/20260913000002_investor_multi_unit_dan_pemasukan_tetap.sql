-- Dua hal yang selama ini tidak bisa diungkapkan sistem (keputusan owner
-- 13 Sep 2026):
--
-- 1. SATU AKUN, BANYAK UNIT. villa_users.unit_id memaksa satu akun = satu
--    unit. Bu Mega memiliki A4 dan A5, jadi ia terpaksa punya dua akun.
-- 2. PEMASUKAN TETAP. Ia membeli dengan skema harga berbeda: menerima angka
--    pasti tiap bulan selama lima tahun, BUKAN jaminan minimal dan bukan
--    bagi hasil. Ini kekhususan satu investor, bukan koreksi atas formula
--    umum -- jaminan Rp 5 juta untuk investor lain tidak disentuh.
create table if not exists public.villa_investor_units (
  user_id    uuid not null references public.villa_users(id) on delete cascade,
  unit_id    uuid not null references public.units(id) on delete restrict,
  unit_nomor text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, unit_id)
);

-- Satu unit hanya boleh dimiliki satu akun. Tanpa ini, dua akun bisa
-- sama-sama mengklaim unit yang sama dan laporan keduanya akan benar
-- sendiri-sendiri sambil saling bertentangan.
create unique index if not exists villa_investor_units_satu_pemilik
  on public.villa_investor_units(unit_id);

create table if not exists public.villa_investor_terms (
  user_id          uuid primary key references public.villa_users(id) on delete cascade,
  pemasukan_tetap  numeric not null check (pemasukan_tetap > 0),
  mulai            date not null,
  selesai          date not null,
  catatan          text,
  created_at       timestamptz not null default now(),
  constraint villa_investor_terms_periode_masuk_akal check (selesai > mulai)
);

alter table public.villa_investor_units enable row level security;
alter table public.villa_investor_terms enable row level security;
revoke all on public.villa_investor_units from anon, authenticated;
revoke all on public.villa_investor_terms from anon, authenticated;

comment on table public.villa_investor_terms is
  'Kekhususan per investor: angka pasti tiap bulan selama periode tertentu, menggantikan bagi hasil DAN jaminan minimal untuk akun itu. Tidak mengubah pembagi dividen dan tidak mengubah hitungan investor lain.';

-- Pemetaan awal: setiap akun investor aktif membawa unit warisannya.
insert into public.villa_investor_units (user_id, unit_id, unit_nomor)
select vu.id, u.id, u.nomor
from public.villa_users vu join public.units u on u.id = vu.unit_id
where vu.role='owner' and vu.is_active
on conflict do nothing;
