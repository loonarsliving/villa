-- Security fix: 14 villa-owned tables were created with RLS left off while
-- PostgREST still grants anon/authenticated full SELECT/INSERT/UPDATE/DELETE.
-- Anyone holding the project's publishable anon key could therefore read AND
-- rewrite villa pricing, rates, competitor data, amenities stock, and CCTV
-- disciplinary reports directly, bypassing villa-api entirely.
--
-- The revenue-engine migrations (20260904000003/4/7, 20260904150000), the
-- amenities migration, and the CCTV disciplinary-report migration each
-- created their tables without the `enable row level security` line that
-- 20260806070012_enable_rls_villa_service_role_only established as this
-- project's convention. This migration closes that gap.
--
-- Pattern: RLS ON with NO policies -- identical to walkin_payments,
-- sync_config, and automation_config. Every legitimate reader/writer of
-- these tables (villa-api, and villa's own /api/* + cron routes via
-- src/lib/supabaseAdmin.ts) authenticates with the service-role key, which
-- bypasses RLS. Verified before applying: villa's frontend instantiates no
-- anon-key Supabase client at all, and the sibling Mkhsistem app never
-- references any of these tables. So this removes anon access and nothing
-- else.

alter table public.villa_room_types              enable row level security;
alter table public.villa_channels                enable row level security;
alter table public.villa_rate_plans              enable row level security;
alter table public.villa_rates                   enable row level security;
alter table public.villa_rate_history            enable row level security;
alter table public.villa_daily_inventory_snapshot enable row level security;
alter table public.villa_pricing_settings        enable row level security;
alter table public.villa_pricing_recommendations enable row level security;
alter table public.villa_high_season_periods     enable row level security;
alter table public.villa_competitor_rates        enable row level security;

alter table public.amenities                     enable row level security;
alter table public.amenity_kit_items             enable row level security;
alter table public.amenity_usage_log             enable row level security;

alter table public.cctv_disciplinary_reports     enable row level security;
