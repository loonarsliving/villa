-- Follow-up to 20260904000003_room_types_channels_rate_plans.sql.
-- APPLIED 2026-09-04 (owner-named directly, 2026-09-04): the 3 Sawah
-- View units are A5, B4, C4. The other 10 units are Standard.
--
-- Also bumps those 3 units' tarif_harian by the owner-confirmed
-- +Rp100,000/hari premium (Rp500,000 -> Rp600,000) -- a real,
-- guest-facing price change, effective immediately for any new booking:
-- villa-api v26's server-side price computation (POST /bookings) reads
-- units.tarif_harian directly, so this takes effect on the next walk-in/
-- direct booking without any further deploy needed.
--
-- Verified post-apply via direct query: A5/B4/C4 -> sawah_view @
-- Rp600,000; the remaining 10 units -> standard @ Rp500,000 (unchanged).

update public.units
set room_type_id = (select id from public.villa_room_types where code = 'sawah_view')
where nomor in ('A5', 'B4', 'C4');

update public.units
set room_type_id = (select id from public.villa_room_types where code = 'standard')
where room_type_id is null;

update public.units
set tarif_harian = tarif_harian + 100000
where nomor in ('A5', 'B4', 'C4');

-- Rollback (for reference, not run automatically -- note this does NOT
-- restore any bookings priced off the bumped tarif_harian in the
-- meantime, only the unit rows themselves):
--   update public.units set tarif_harian = tarif_harian - 100000 where nomor in ('A5','B4','C4');
--   update public.units set room_type_id = null where nomor in ('A5','B4','C4');
