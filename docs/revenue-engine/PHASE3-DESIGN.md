# Phase 3 — Room Type / Channel / Rate Plan / Rate History

Status: **schema designed and written, NOT applied.**
`supabase/migrations/20260904000003_room_types_channels_rate_plans.sql`.

## What it adds

- `villa_room_types` — empty catalog table. No rows seeded (see "Open
  question" below).
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

## Open question — blocks meaningfully populating this schema

**Room types**: Loonars' 13 units have no room-type dimension today —
confirmed directly from `units`' actual columns (`nomor`, `blok`, status,
owner fields, `tarif_harian`/`tarif_bulanan` — no category/type column
at all). Per the gap audit's §15 ("Requirements requiring business-owner
decisions"), this needs an explicit answer before it's useful:

- Does the owner want to define **real room types** now (e.g. "Deluxe",
  "Standard", grouped by block or by actual amenity/size differences)?
- Or should Phase 3 proceed with a **single placeholder room type**
  covering all 13 units, revisited later once real categories are
  decided?

Nothing in this migration forces either answer — `room_type_id` is
nullable and every unit currently has none. **This program will not
guess at real room-type names or groupings**, per the mandate's own rule
against inventing business data.

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
