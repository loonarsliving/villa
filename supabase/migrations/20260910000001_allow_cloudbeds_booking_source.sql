-- Fixes a bug found via a live end-to-end test of the Cloudbeds webhook
-- (2026-09-10): bookings.sumber's check constraint never included
-- 'cloudbeds' as an allowed value, so every Cloudbeds/OTA reservation the
-- webhook route ever tried to save (sumber:'cloudbeds') was silently
-- rejected at the database level -- the webhook itself had no bug, the
-- reservation just could never be inserted. Purely additive: widens the
-- allowed set, touches no existing rows.
alter table bookings drop constraint bookings_sumber_check;
alter table bookings add constraint bookings_sumber_check
  check (sumber = any (array['walk-in', 'airbnb', 'tiket', 'agoda', 'booking.com', 'website', 'whatsapp', 'other', 'cloudbeds']));
