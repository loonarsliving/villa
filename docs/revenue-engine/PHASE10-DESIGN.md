# Phase 10 — Occupancy forecast foundation

Status: built this round — `src/app/api/admin/occupancy-forecast/route.ts`,
`src/app/admin/occupancy-forecast/page.tsx`.

## What it is

A 14-day occupancy forecast on `/admin/occupancy-forecast`, computed as a
**day-of-week seasonality average**: for each of the next 14 days,
average that same weekday's real occupancy (from
`villa_daily_inventory_snapshot`, Phase 4) over the last 8 weeks.
Deterministic — no model call anywhere in this route.

## Why not AI/ML forecasting

The master mandate is explicit (§60/§28) that "advanced forecasting"
only becomes meaningful once real historical data accumulates — with
near-zero booking history at launch, an ML model would just fit noise
and present it with false confidence. A day-of-week average is the
simplest honest thing that (a) actually uses real data only, (b)
improves automatically as more snapshot history accumulates with zero
code changes, and (c) is trivially explainable to a non-technical owner.
This is deliberately the FOUNDATION Phase 10 asks for — not a promise
that it's the final forecasting method.

## Honesty guardrail

Any day-of-week bucket with fewer than `MIN_SAMPLES_FOR_FORECAST` (3)
real historical observations reports `forecast_occupancy_pct: null`
rather than a number computed from 1-2 data points — the UI shows
"belum cukup data" for that cell. At launch (Phase 4's snapshot cron
just started, no backfill possible by design), this will correctly be
the state for every cell for the first few weeks. That's the honest
output, not a bug — see the same caveat already documented for Phase 5's
Revenue Dashboard and Phase 7's Pricing Calendar.

## Explicit non-goals

- Does not forecast revenue or ADR, only occupancy % — extending to
  revenue forecasting is a natural next increment once occupancy
  forecasting itself has been validated against real outcomes.
- Does not feed into the Phase 6 rule engine's recommendations — kept as
  a separate, independently-readable signal, not a hidden input to
  pricing decisions.
