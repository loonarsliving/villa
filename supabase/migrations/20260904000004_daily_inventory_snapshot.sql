-- Phase 4 (§7 of the revenue-engine program): daily inventory snapshot.
-- Flagged in the program as the single most time-sensitive item -- the
-- data clock cannot be backfilled, so this table/job should start
-- collecting as early as possible, independent of when the rest of
-- Phase 3/4's schema work lands.
--
-- NOT YET APPLIED. One row per (snapshot_date, unit_id), append-only in
-- practice (the unique constraint makes a same-day re-run of the cron an
-- idempotent upsert, not a duplicate -- see the corresponding cron route
-- in src/app/api/cron/daily-inventory-snapshot/route.ts).

create table if not exists public.villa_daily_inventory_snapshot (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  unit_id uuid not null references public.units(id),
  room_type_id uuid references public.villa_room_types(id),
  unit_status text not null,
  on_books boolean not null,
  captured_at timestamptz not null default now(),
  unique (snapshot_date, unit_id)
);

create index if not exists villa_daily_inventory_snapshot_date_idx
  on public.villa_daily_inventory_snapshot (snapshot_date);

-- Rollback (for reference, not run automatically):
--   drop table if exists public.villa_daily_inventory_snapshot;
--
-- Note: this migration depends on villa_room_types existing (Phase 3,
-- migration 20260904000003) only for the optional room_type_id FK --
-- apply that migration first, or drop the FK constraint here if Phase 3
-- is deferred and this snapshot needs to start collecting sooner without
-- it (room_type_id would just stay NULL on every row until Phase 3
-- lands, which is an acceptable degraded-but-still-useful state given
-- how time-sensitive this table is).
