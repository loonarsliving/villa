# Phase 7 — Pricing Calendar (visual grid)

Status: **built this round** — `src/app/api/admin/pricing-calendar/route.ts`,
`src/app/admin/pricing-calendar/page.tsx`. Read-only, no schema change.

## What it adds

A room-type × next-14-days grid on `/admin/pricing-calendar`. Each cell
shows:

- the real live rate a guest is charged today for that room type
  (`units.tarif_harian` — the actual `POST /bookings` source of truth,
  not `villa_rates`, so this never shows a number the guest wouldn't
  actually see),
- a planned `villa_rates` entry for that date, when one exists, shown
  only if it differs from the live rate (source tagged: `manual` /
  `rule_engine` / `ai_recommendation` / `cloudbeds_sync`),
- a badge if a Phase 6 recommendation is pending review or has been
  approved/executed for that date,
- occupancy % from `villa_daily_inventory_snapshot`, or an honest
  "belum ada data" when no snapshot exists yet for that date (same
  caveat as Phase 4/5: the cron only captures data going forward from
  whenever it started running, no historical backfill).

Admin-gated the same way as `/api/admin/revenue-metrics` and
`/api/admin/cloudbeds/rooms` — forwards `x-villa-token` to
`isAdminToken()`, no separate auth path invented.

## Explicit non-goal

This page does not let an admin edit a rate directly — that would be a
second, unreviewed way to change pricing outside the Phase 9 approval
flow. All price changes still go through
`/admin/pricing-recommendations`. If the owner wants direct manual rate
overrides later, that's a distinct, explicit feature request — not
assumed here.
