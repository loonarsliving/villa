-- Public website bookings (POST /public/bookings) now start as
-- 'menunggu_pembayaran' instead of immediately 'terjadwal', so the unit is
-- NOT locked and does not appear on the staff calendar until the guest
-- uploads proof of transfer (POST /public/bookings/confirm-payment flips it
-- to 'terjadwal'). Owner's explicit instruction, 2026-09-11. Applied to
-- production via apply_migration on 2026-09-11.
--
-- 'menunggu_pembayaran' is deliberately left OUTSIDE the
-- bookings_no_overlap_active exclusion constraint (which only covers
-- 'terjadwal'/'checkin'), so multiple pending bookings for the same
-- unit/dates can coexist; the UPDATE that flips status to 'terjadwal' is
-- what enforces no-double-booking (it fails with 23P01 if another booking
-- already locked the unit first).

alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status = any (array['terjadwal'::text, 'checkin'::text, 'checkout'::text, 'batal'::text, 'menunggu_pembayaran'::text]));

comment on column public.bookings.status is 'menunggu_pembayaran: public website booking created but guest has not yet uploaded proof of transfer -- does not occupy the unit and is excluded from availability/conflict checks and the staff calendar until confirmed to terjadwal via /public/bookings/confirm-payment.';
