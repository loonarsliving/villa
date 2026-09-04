-- APPLIED 2026-09-04 (owner-provided, confirmed via AskUserQuestion
-- before applying since it directly changes real guest-facing pricing).
--
-- Owner's pricing structure: base/min/max guardrail per room type, with
-- a consistent +Rp100,000 Sawah View premium at every tier:
--   Standard:    min 600,000 | base 650,000 | max 1,000,000
--   Sawah View:  min 700,000 | base 750,000 | max 1,100,000
--
-- min_rate/max_rate are new, additive columns on villa_room_types --
-- guardrail storage for the Phase 6 Revenue Engine (not yet built).
-- They do not themselves change any booking behavior today; they exist
-- so a future pricing recommendation/rule engine has somewhere to read
-- "how far can this move" from, per the master mandate's §14/§35
-- pricing-guardrails requirement.
--
-- units.tarif_harian IS updated to the new base rate now (was
-- 500,000/600,000 after the earlier Sawah View migration, now
-- 650,000/750,000) -- villa-api v26's POST /bookings reads this
-- directly for server-side pricing, so this takes effect immediately
-- for new walk-in/direct bookings. tarif_bulanan (monthly rate) is
-- untouched -- the owner's instruction only specified daily-rate
-- figures; do not assume a proportional monthly change without asking.
--
-- Verified post-apply via direct query: matches exactly (see commit
-- message / session record).

alter table public.villa_room_types
  add column if not exists min_rate numeric,
  add column if not exists max_rate numeric;

update public.villa_room_types set min_rate = 600000, max_rate = 1000000 where code = 'standard';
update public.villa_room_types set min_rate = 700000, max_rate = 1100000 where code = 'sawah_view';

update public.units
set tarif_harian = 650000
where room_type_id = (select id from public.villa_room_types where code = 'standard');

update public.units
set tarif_harian = 750000
where room_type_id = (select id from public.villa_room_types where code = 'sawah_view');

-- Rollback (for reference, not run automatically -- does not restore
-- bookings already priced off these rates, only the unit/room-type
-- rows themselves):
--   update public.units set tarif_harian = 500000 where room_type_id = (select id from public.villa_room_types where code = 'standard');
--   update public.units set tarif_harian = 600000 where room_type_id = (select id from public.villa_room_types where code = 'sawah_view');
--   alter table public.villa_room_types drop column if exists min_rate, drop column if exists max_rate;
