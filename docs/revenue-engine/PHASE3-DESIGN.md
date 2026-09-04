# Phase 3 — Room Type / Channel / Rate Plan / Rate History

Status: **APPLIED to production 2026-09-04 (owner-approved)**, with one
follow-up still pending (see "Pending follow-up" below).
`supabase/migrations/20260904000003_room_types_channels_rate_plans.sql`.

## What it adds

- `villa_room_types` — seeded with 2 rows per explicit owner instruction
  (2026-09-04): `standard` ("Standard") and `sawah_view` ("Sawah View" —
  rice-field view, **+Rp100,000/hari** over Standard). These are the
  owner's own category names and premium amount, not invented.
- `units.room_type_id` — new nullable FK, no backfill.
- `villa_channels` — seeded with exactly the two values already found in
  live `bookings.sumber` (`cloudbeds`, `walk-in`) — nothing invented.
- `bookings.channel_id` — new nullable FK, backfilled *only* for rows
  whose `sumber` exactly matches a seeded channel code; anything else
  stays NULL rather than guessed. `bookings.sumber` itself is never
  modified.
- `villa_rate_plans`, `villa_rates`, `villa_rate_history` — empty, ready
  to be populated once room types/rate plans are defined. A trigger on
  `villa_rates` automatically writes to `villa_rate_history` on every
  insert/rate-changing update, so rate history can never be forgotten by
  whatever application code writes rates later (Phase 6's Revenue
  Engine, or a manual admin UI).

## Unit assignment — RESOLVED 2026-09-04

Owner named the 3 Sawah View units directly: **A5, B4, C4**. Applied via
`20260904000005_assign_sawah_view_units.sql`:
- A5, B4, C4 → `sawah_view`, `tarif_harian` bumped Rp500,000 → Rp600,000.
- The remaining 10 units (A1–A4, B1–B3, C1–C3) → `standard`, unchanged
  at Rp500,000.

Verified post-apply via direct query — matches exactly. This price
change is live now: villa-api v26's `POST /bookings` reads
`units.tarif_harian` directly for server-side pricing, so any new
walk-in/direct booking for A5/B4/C4 already uses Rp600,000 without any
further deploy.

**Channel granularity**: the current Cloudbeds webhook payload (per
`src/app/api/webhooks/cloudbeds/route.ts`) does not capture a specific
OTA sub-channel (Booking.com vs. Agoda vs. Traveloka, etc.) — every
Cloudbeds-sourced booking is tagged only `sumber = 'cloudbeds'`. Whether
Cloudbeds' reservation webhook payload exposes a `sourceName`/`channel`
field that could populate a more granular `villa_channels` row per OTA
is **unconfirmed** — same blocker as the outbound API capability check
(§16 of the master mandate). Until confirmed, all OTA bookings collapse
into one `cloudbeds` channel row for analytics purposes, which is
honest given what's actually known today, not a limitation of this
schema design.

## Testing

Schema-only migration — no application code depends on these tables yet,
so there's nothing to typecheck/build against on the Next.js or
`villa-api` side from this migration alone. Before applying: same
process as Phase 1 (review, confirm, apply, verify via `list_tables`).
