-- Fixes two defects found reviewing the AI dynamic pricing feature
-- (2026-09-11, owner-requested review before the 20 Sep opening).
--
-- 1. villa_room_types.base_rate -- the STABLE anchor every pricing
--    calculation starts from. Before this, the engine computed from
--    units.tarif_harian and then overwrote units.tarif_harian with its
--    own result, so each run fed on the previous run's output: two
--    manual runs on 2026-09-11 moved Standard 650,000 -> 685,000 ->
--    716,500 and Sawah View 750,000 -> 775,000 -> 797,500 -- upward,
--    during LOW occupancy, because the +100,000 weekend surcharge got
--    baked into the base and re-applied every run (x -> 0.9x + 100,000
--    converges up to 1,000,000). Anchoring to a fixed base_rate makes
--    the engine idempotent: running it ten times gives the same price.
--
--    Seeded with the owner-approved base rates already documented in
--    20260904000006_room_type_price_guardrails.sql (Standard 650,000 /
--    Sawah View 750,000) -- not a new pricing decision, just recording
--    the existing one somewhere the engine can't overwrite.
--
-- 2. villa_pricing_settings.ai_autopush_enabled -- kill switch for
--    autonomous price pushes to Cloudbeds. Defaults to FALSE per owner
--    instruction 2026-09-11 ("untuk saat ini masih ikuti harga
--    cloudbeds, sembari ai menganalisa pasar"): the engine computes and
--    records its decisions for review, but the live price keeps
--    following Cloudbeds until the owner switches this on.
--
-- Strictly additive: no column dropped, renamed, or repurposed; no
-- existing row's meaning changed.

alter table public.villa_room_types
  add column if not exists base_rate numeric;

update public.villa_room_types set base_rate = 650000 where code = 'standard' and base_rate is null;
update public.villa_room_types set base_rate = 750000 where code = 'sawah_view' and base_rate is null;

alter table public.villa_pricing_settings
  add column if not exists ai_autopush_enabled boolean not null default false;

-- Rollback (for reference, not run automatically):
--   alter table public.villa_pricing_settings drop column if exists ai_autopush_enabled;
--   alter table public.villa_room_types drop column if exists base_rate;
