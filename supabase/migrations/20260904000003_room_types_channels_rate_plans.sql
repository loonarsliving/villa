-- Phase 3 (revenue-engine program): normalized revenue data model --
-- room types, channels, rate plans, daily rates, rate history.
--
-- APPLIED 2026-09-04 (owner-approved) with two room types seeded per
-- explicit owner instruction: 'standard' and 'sawah_view' (+Rp100,000/
-- hari premium for the 3 units with a rice-field view). Unit assignment
-- (units.room_type_id) and the Sawah View units' tarif_harian bump are
-- a FOLLOW-UP migration, pending the owner naming which 3 of the 13
-- units those are -- not guessed, see PHASE3-DESIGN.md. Strictly
-- additive: no existing column is dropped, renamed, or has its meaning
-- changed. `bookings.sumber` (the existing free-text column) is
-- preserved exactly as-is; `channel_id` is a new, nullable, parallel
-- column.

-- ============================================================
-- 1. Room types
-- ============================================================
create table if not exists public.villa_room_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  capacity integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seeded per explicit owner instruction (2026-09-04): two room types --
-- Standard, and Sawah View (rice-field view) at +Rp100,000/hari over
-- Standard. Nothing else was invented -- the owner named these two
-- categories and the premium amount directly.
insert into public.villa_room_types (code, name, description)
values
  ('standard', 'Standard', 'Unit villa standar, tanpa view sawah.'),
  ('sawah_view', 'Sawah View', 'Unit villa dengan pemandangan sawah -- premium +Rp100.000/hari dari tarif standard.')
on conflict (code) do nothing;

alter table public.units
  add column if not exists room_type_id uuid references public.villa_room_types(id);

-- No backfill of units.room_type_id is performed here. The owner named
-- the two categories and the premium amount, but not yet WHICH 3 of the
-- 13 units are Sawah View -- this column stays NULL until that's known
-- (see PHASE3-DESIGN.md's follow-up section), rather than guessing.
-- Same reasoning applies to NOT bumping those units' tarif_harian by
-- +Rp100,000 yet.

-- ============================================================
-- 2. Channels
-- ============================================================
create table if not exists public.villa_channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('ota', 'direct', 'walkin', 'other')),
  commission_percent numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed only the two channel values that actually exist in
-- bookings.sumber today (verified, not guessed) -- 'cloudbeds' and
-- 'walk-in'. Additional OTA sub-channels (Booking.com, Agoda, etc. as
-- distributed *through* Cloudbeds) are not seeded here because Loonars'
-- webhook payload does not currently capture a sub-channel/source name
-- from Cloudbeds -- see PHASE3-DESIGN.md for the open question on
-- whether Cloudbeds' payload exposes this at all.
insert into public.villa_channels (code, name, type, active)
values
  ('cloudbeds', 'Cloudbeds (OTA aggregate)', 'ota', true),
  ('walk-in', 'Walk-in / Direct', 'walkin', true)
on conflict (code) do nothing;

alter table public.bookings
  add column if not exists channel_id uuid references public.villa_channels(id);

-- Backfill: map only the two known exact `sumber` values. Anything else
-- (there should be none today, per the webhook/villa-api source read,
-- but this is defensive) is left NULL rather than guessed -- a NULL
-- channel_id on an old row is a visible, honest "unmapped," not a wrong
-- answer. bookings.sumber itself is never modified.
update public.bookings b
set channel_id = c.id
from public.villa_channels c
where b.channel_id is null
  and b.sumber = c.code;

-- ============================================================
-- 3. Rate plans
-- ============================================================
create table if not exists public.villa_rate_plans (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid references public.villa_room_types(id),
  channel_id uuid references public.villa_channels(id),
  code text not null unique,
  name text not null,
  base_rate numeric,
  cancellation_policy text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 4. Daily rates + rate history (append-only, auto-logged via trigger)
-- ============================================================
create table if not exists public.villa_rates (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references public.villa_room_types(id),
  rate_plan_id uuid references public.villa_rate_plans(id),
  date date not null,
  rate numeric not null check (rate >= 0),
  source text not null default 'manual' check (source in ('manual', 'rule_engine', 'ai_recommendation', 'cloudbeds_sync')),
  reason text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_type_id, rate_plan_id, date)
);

create table if not exists public.villa_rate_history (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null,
  rate_plan_id uuid,
  date date not null,
  previous_rate numeric,
  new_rate numeric not null,
  source text not null,
  changed_by text,
  reason text,
  created_at timestamptz not null default now()
);
-- Deliberately no FK from villa_rate_history to villa_rates/villa_room_types
-- -- history must survive even if a room type or rate plan is later
-- deactivated or its row structure changes; it's an audit trail, not a
-- live-referencing table.

create or replace function public.villa_rates_log_history()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.villa_rate_history (room_type_id, rate_plan_id, date, previous_rate, new_rate, source, changed_by, reason)
    values (new.room_type_id, new.rate_plan_id, new.date, null, new.rate, new.source, new.updated_by, new.reason);
  elsif TG_OP = 'UPDATE' and old.rate is distinct from new.rate then
    insert into public.villa_rate_history (room_type_id, rate_plan_id, date, previous_rate, new_rate, source, changed_by, reason)
    values (new.room_type_id, new.rate_plan_id, new.date, old.rate, new.rate, new.source, new.updated_by, new.reason);
  end if;
  return new;
end;
$$;

drop trigger if exists villa_rates_history_trg on public.villa_rates;
create trigger villa_rates_history_trg
  after insert or update on public.villa_rates
  for each row execute function public.villa_rates_log_history();

-- Rollback (for reference, not run automatically):
--   drop trigger if exists villa_rates_history_trg on public.villa_rates;
--   drop function if exists public.villa_rates_log_history();
--   drop table if exists public.villa_rate_history;
--   drop table if exists public.villa_rates;
--   drop table if exists public.villa_rate_plans;
--   alter table public.bookings drop column if exists channel_id;
--   drop table if exists public.villa_channels;
--   alter table public.units drop column if exists room_type_id;
--   drop table if exists public.villa_room_types;
