-- Voucher melekat pada UNIT, bukan pada akun.
--
-- Keputusan owner: 12 poin per unit, jadi pemilik dua unit dapat 24. Selama
-- kuncinya (user_id, periode), dua puluh empat voucher tidak mungkin berada
-- di satu akun -- akan ada dua voucher untuk bulan yang sama. Memindahkannya
-- ke (unit_id, periode) membuat aturan sesungguhnya yang dijaga database:
-- satu unit, satu voucher, satu bulan. Itu juga yang membuat voucher ikut
-- berpindah dengan benar kalau suatu hari unitnya berganti pemilik.
alter table public.villa_investor_vouchers
  add column if not exists unit_id uuid references public.units(id) on delete restrict;

update public.villa_investor_vouchers v
set unit_id = u.unit_id
from public.villa_users u
where u.id = v.user_id and v.unit_id is null;

alter table public.villa_investor_vouchers alter column unit_id set not null;

alter table public.villa_investor_vouchers drop constraint if exists villa_investor_vouchers_satu_per_bulan;
alter table public.villa_investor_vouchers add constraint villa_investor_vouchers_satu_per_unit_per_bulan
  unique (unit_id, periode);

create index if not exists villa_investor_vouchers_unit_idx on public.villa_investor_vouchers(unit_id, periode);
