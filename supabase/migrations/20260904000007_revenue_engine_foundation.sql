-- Phase 6 foundation (revenue-engine program): deterministic Revenue
-- Engine storage. Per explicit owner instruction (2026-09-04): build the
-- structure now so real data (accumulating via the Phase 4 daily
-- snapshot cron, live since today) has somewhere to land -- this
-- migration creates schema and seeds only explicitly-labeled DEFAULT
-- settings, never fabricated business data.
--
-- NOT YET APPLIED -- written for review, same process as every prior
-- migration in this program.

-- ============================================================
-- 1. Pricing settings -- guardrails the rule engine must respect.
--    Room-type-level min_rate/max_rate already exist on
--    villa_room_types (added 20260904000006). This table holds the
--    GLOBAL rule-engine parameters: how far a single recommendation may
--    move the rate, and the occupancy thresholds that trigger a
--    recommendation at all.
-- ============================================================
create table if not exists public.villa_pricing_settings (
  id uuid primary key default gen_random_uuid(),
  max_daily_movement_pct numeric not null default 0.15,
  high_occupancy_threshold_pct numeric not null default 80,
  high_occupancy_adjustment_pct numeric not null default 0.10,
  low_occupancy_threshold_pct numeric not null default 30,
  low_occupancy_adjustment_pct numeric not null default -0.10,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Seed exactly one settings row with DEFAULT values -- these are
-- starting points for the owner to review/adjust via the admin UI, not
-- values the owner specified. Explicitly labeled as such in the row
-- itself (updated_by) so nobody mistakes this for an owner decision.
insert into public.villa_pricing_settings (max_daily_movement_pct, high_occupancy_threshold_pct, high_occupancy_adjustment_pct, low_occupancy_threshold_pct, low_occupancy_adjustment_pct, updated_by)
select 0.15, 80, 0.10, 30, -0.10, 'system_default_pending_owner_review'
where not exists (select 1 from public.villa_pricing_settings);

-- ============================================================
-- 2. Pricing recommendations -- one row per (room_type, target_date)
--    the rule engine has generated a recommendation for. Mirrors the
--    existing cctv_disciplinary_reports pending_review/reviewed_by/
--    reviewed_at pattern already proven in this codebase.
-- ============================================================
create table if not exists public.villa_pricing_recommendations (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references public.villa_room_types(id),
  target_date date not null,
  current_rate numeric not null,
  recommended_rate numeric not null,
  delta_pct numeric not null,
  reason_codes text[] not null default '{}',
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  guardrail_status text not null check (guardrail_status in ('within_range', 'clamped_min', 'clamped_max', 'clamped_movement')),
  occupancy_pct numeric,
  pickup_bookings_3d integer,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'executed', 'expired')),
  generated_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  executed_at timestamptz
);

-- Only one PENDING recommendation per room_type+date at a time -- a
-- re-run of the generation cron before the existing one is reviewed
-- must not pile up duplicates.
create unique index if not exists villa_pricing_recommendations_pending_unique
  on public.villa_pricing_recommendations (room_type_id, target_date)
  where status = 'pending_review';

create index if not exists villa_pricing_recommendations_target_date_idx
  on public.villa_pricing_recommendations (target_date);

-- Rollback (for reference, not run automatically):
--   drop table if exists public.villa_pricing_recommendations;
--   drop table if exists public.villa_pricing_settings;
