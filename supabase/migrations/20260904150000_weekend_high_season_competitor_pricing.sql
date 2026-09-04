-- Revenue Engine extension (owner request 2026-09-04): weekend surcharge +
-- high-season market-aware pricing.
--
-- 1. villa_high_season_periods -- admin-defined date ranges (e.g. libur
--    Natal/Tahun Baru, libur sekolah) with a suggested baseline adjustment.
--    The deterministic cron (generate-pricing-recommendations) reads this
--    to decide whether a target_date is "high season"; it never invents
--    the date range itself.
-- 2. villa_competitor_rates -- observed prices at nearby hotels/villas.
--    Rows can come from an admin typing a number in manually, or from an
--    AI research call (Gemini w/ Google Search grounding, via Mkhsistem's
--    bridge) that an admin explicitly triggers -- either way this is
--    reference data the rule engine reads, never something the AI writes
--    directly into a live rate. Same "human/rule approves, AI only
--    informs" discipline as the existing pricing-insight bridge.

create table if not exists public.villa_high_season_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  start_date date not null,
  end_date date not null,
  suggested_adjustment_pct numeric not null default 0.15,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint villa_high_season_periods_dates_chk check (end_date >= start_date)
);

create index if not exists villa_high_season_periods_range_idx
  on public.villa_high_season_periods (start_date, end_date)
  where active;

create table if not exists public.villa_competitor_rates (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid references public.villa_room_types(id),
  location_label text not null,
  competitor_name text not null,
  competitor_type text not null check (competitor_type in ('hotel', 'villa', 'other')),
  price numeric not null check (price >= 0),
  currency text not null default 'IDR',
  source text not null default 'manual' check (source in ('manual', 'ai_research')),
  source_note text,
  observed_at date not null default current_date,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists villa_competitor_rates_room_type_date_idx
  on public.villa_competitor_rates (room_type_id, observed_at);

-- Rollback (for reference, not run automatically):
--   drop table if exists public.villa_competitor_rates;
--   drop table if exists public.villa_high_season_periods;
