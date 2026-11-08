-- Tiruan minimal objek Supabase yang dipakai migrasi 20261108000001
-- (villa_users, bookings, peran Supabase) untuk uji di Postgres lokal.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table public.villa_users (id uuid primary key default gen_random_uuid(), nama text, role text);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'menunggu_pembayaran',
  property_kode text not null default 'PL',
  tarif numeric
);
