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

## Pending follow-up — one piece of data still needed

**Room types are now decided** (2 categories, per owner instruction
2026-09-04): Standard and Sawah View (+Rp100,000/hari). What's still
missing: **which 3 of the 13 units** (`A1`–`A5`, `B1`–`B4`, `C1`–`C4`)
are the Sawah View ones. Until that's named, `units.room_type_id` stays
NULL for all 13 units and no unit's `tarif_harian` has been changed —
**this program will not guess which units have the view**, per the
mandate's own rule against inventing business data.

Once named, the follow-up migration does exactly two things, both
trivial and fully reversible:
1. `UPDATE units SET room_type_id = (sawah_view id) WHERE nomor IN (...)`
   and the rest default to `standard`.
2. `UPDATE units SET tarif_harian = tarif_harian + 100000 WHERE nomor IN
   (...)` — a real, guest-facing price change (it feeds directly into
   `POST /bookings`' server-side price computation, live since v26), so
   this step specifically should be double-confirmed with the owner
   right before running, not bundled silently into the room-type
   assignment.

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
