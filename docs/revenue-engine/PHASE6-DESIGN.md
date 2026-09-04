# Phase 6 — Revenue Engine foundation (deterministic rule engine)

Status: **APPLIED/DEPLOYED to production 2026-09-04** —
`supabase/migrations/20260904000007_revenue_engine_foundation.sql`
(applied), `src/app/api/cron/generate-pricing-recommendations/route.ts`
(shipped in this branch's merge to `main`),
`supabase/functions/villa-api/phase6-draft/CHANGES.md` (villa-api
deployed as v28).

Built per the owner's explicit instruction to lay the foundation for
every remaining phase now, ahead of real booking volume, so structure is
ready the moment real data starts flowing in.

## What it adds

- `villa_pricing_settings` — one active row of tunable guardrails
  (max daily movement %, high/low occupancy thresholds and
  adjustments). Seeded with a single default row,
  `updated_by='system_default_pending_owner_review'` — these are
  starting values, not owner-confirmed numbers, and are flagged as such
  so nobody mistakes them for a business decision.
- `villa_pricing_recommendations` — one row per (room type, date)
  candidate price change. `pending_review` → `approved`/`rejected`/
  `executed`, mirroring the existing `cctv_disciplinary_reports`
  pattern already used elsewhere in this codebase. Partial unique index
  on `(room_type_id, target_date) WHERE status='pending_review'` so the
  daily cron can safely refresh an existing pending row instead of
  duplicating it.
- `/api/cron/generate-pricing-recommendations` — deterministic rule
  engine (NOT AI/LLM — every number comes from a fixed formula reading
  real `bookings`/`units` data). Rule: occupancy ≥ high threshold →
  recommend `+high_occupancy_adjustment_pct`; occupancy ≤ low threshold
  → recommend `low_occupancy_adjustment_pct` (negative); otherwise no
  recommendation is generated for that date at all. Always clamped to
  the room type's `min_rate`/`max_rate` (Phase 3 guardrails) and to
  `max_daily_movement_pct`. Confidence (`low`/`medium`/`high`) is
  derived from total real non-cancelled booking count observed — with
  near-zero booking volume today, this will correctly report `low` for
  everything, which is the honest output, not a bug.
- `villa-api` v26 → v27: two new admin-only endpoints,
  `GET /admin/pricing-recommendations` (list, optional `?status=`
  filter) and `PATCH /admin/pricing-recommendations` (approve/reject).
  Approving writes the rate into `villa_rates` (Phase 3, full history
  via its existing trigger) and marks the recommendation `executed`.
  Rejecting just records the decision. Full diff:
  `supabase/functions/villa-api/phase6-draft/CHANGES.md`.

## Explicit non-goals this round

- **No autonomous price changes.** The cron only ever writes
  `pending_review` rows. Nothing changes a live price without a human
  clicking Approve on `/admin/pricing-recommendations` (Phase 9).
- **`villa_rates` is not wired into booking-time pricing.**
  `POST /bookings` still prices off `units.tarif_harian` only. Approving
  a recommendation records the planned rate for that date but does not
  yet change what a guest is actually charged — see the Scope note in
  `phase6-draft/CHANGES.md`. Wiring `villa_rates` into `POST /bookings`
  (checking the stay date first, falling back to `tarif_harian`) is
  real, buildable, explicitly flagged next work, not done silently here.
- `villa_pricing_settings`' seeded thresholds are defaults, not an
  owner-approved business rule — safe to run (guardrail-clamped either
  way), but worth a real conversation with the owner once real
  occupancy data exists to tune against.

## Cron

`vercel.json`: `10 16 * * *` (00:10 WITA), same `CRON_SECRET` bearer-auth
pattern as the other cron routes.
