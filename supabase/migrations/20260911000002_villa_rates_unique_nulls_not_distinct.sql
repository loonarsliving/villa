-- villa_rates' uniqueness key contains a nullable column
-- (rate_plan_id, NULL for every room-type-level rate we store), and
-- Postgres treats NULLs as distinct by default. So
-- `UNIQUE (room_type_id, rate_plan_id, date)` did NOT actually prevent
-- two rows for the same room type + date, and any
-- `ON CONFLICT (room_type_id, rate_plan_id, date)` upsert against it --
-- villa-api's own approved-recommendation write does exactly this --
-- would INSERT a duplicate instead of updating the existing row.
--
-- Postgres 15+ (this project runs 17.6) can express the intended
-- meaning directly. Verified before applying: zero duplicate
-- (room_type_id, date) rows exist today, so adding the stricter
-- constraint cannot fail on live data.
--
-- With this in place, the Cloudbeds rate sync can also write its whole
-- window in one batched upsert instead of a select-then-write round
-- trip per date, which is what makes widening that window from 14 to
-- 90 days fit inside the request time limit.

alter table public.villa_rates
  drop constraint if exists villa_rates_room_type_id_rate_plan_id_date_key;

alter table public.villa_rates
  add constraint villa_rates_room_type_id_rate_plan_id_date_key
  unique nulls not distinct (room_type_id, rate_plan_id, date);

-- Rollback (for reference, not run automatically):
--   alter table public.villa_rates drop constraint villa_rates_room_type_id_rate_plan_id_date_key;
--   alter table public.villa_rates add constraint villa_rates_room_type_id_rate_plan_id_date_key
--     unique (room_type_id, rate_plan_id, date);
