-- Uji perilaku migrasi 20261108000001_kupon_investor_el.sql (lihat README.md).
\set QUIET on
\pset tuples_only on
create temp table hasil (nama text, lulus boolean);
create or replace function pg_temp.harus_gagal(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when check_violation or unique_violation or foreign_key_violation then return true; end $$;

insert into villa_users (id, nama, role) values ('00000000-0000-0000-0000-000000000001', 'Investor', 'owner');
insert into villa_investor_kupon (user_id, kode) values ('00000000-0000-0000-0000-000000000001', 'INV-AB23CD'), ('00000000-0000-0000-0000-000000000001', 'INV-XY45ZQ');
insert into hasil select 'kode valid diterima, default 20% aktif', (select bool_and(diskon_persen = 20 and aktif) and count(*) = 2 from villa_investor_kupon);
insert into hasil select 'format kode salah ditolak', pg_temp.harus_gagal($$insert into villa_investor_kupon (user_id, kode) values ('00000000-0000-0000-0000-000000000001','INV-abc')$$);
insert into hasil select 'kode kembar ditolak', pg_temp.harus_gagal($$insert into villa_investor_kupon (user_id, kode) values ('00000000-0000-0000-0000-000000000001','INV-AB23CD')$$);
insert into hasil select 'persen > 50 ditolak', pg_temp.harus_gagal($$insert into villa_investor_kupon (user_id, kode, diskon_persen) values ('00000000-0000-0000-0000-000000000001','INV-PPPPPP', 80)$$);

insert into bookings (property_kode, tarif, investor_kupon_id, diskon_kupon)
  select 'EL', 800000, id, 200000 from villa_investor_kupon where kode = 'INV-AB23CD';
insert into hasil select 'booking berkupon tersimpan', (select count(*) = 1 from bookings where diskon_kupon = 200000);
insert into hasil select 'kode dipakai dua kali ditolak', pg_temp.harus_gagal($$insert into bookings (investor_kupon_id) select id from villa_investor_kupon where kode = 'INV-AB23CD'$$);
update bookings set status = 'batal' where diskon_kupon = 200000;
insert into hasil select 'kode tetap terpakai walau booking batal', pg_temp.harus_gagal($$insert into bookings (investor_kupon_id) select id from villa_investor_kupon where kode = 'INV-AB23CD'$$);
insert into hasil select 'diskon negatif ditolak', pg_temp.harus_gagal($$insert into bookings (diskon_kupon) values (-1)$$);
insert into bookings (tarif) values (500000);
insert into hasil select 'booking biasa tanpa kupon tetap jalan', (select count(*) = 1 from bookings where tarif = 500000 and investor_kupon_id is null);
insert into hasil select 'kupon yang dipakai booking tidak bisa dihapus', (select pg_temp.harus_gagal($$delete from villa_investor_kupon where kode = 'INV-AB23CD'$$));
insert into hasil select 'RLS aktif', (select relrowsecurity from pg_class where relname = 'villa_investor_kupon');
insert into hasil select 'anon/authenticated tanpa hak', (select not has_table_privilege('anon','public.villa_investor_kupon','select') and not has_table_privilege('authenticated','public.villa_investor_kupon','select'));

select case when lulus then 'PASS ' else 'FAIL ' end || nama from hasil;
