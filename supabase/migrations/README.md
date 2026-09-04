# Migration history — baseline note

**No migration files exist for the schema changes made before this
directory was created.** The live database (Supabase project
`svcmybsziaelwwdrnzcv`) already has a real, deployed schema — dozens of
villa-related and Mkhsistem-related tables — built up over time via ad hoc
`apply_migration` calls made from various sessions, none of which were
ever checked into this or any other repository. This directory does
**not** attempt to reconstruct that history.

## Rule going forward

Starting now, **every** schema change to any villa-owned table must:

1. Be written as a new, numbered SQL file in this directory
   (`<timestamp>_<description>.sql`, matching the Supabase CLI's own
   migration naming convention).
2. Be **strictly additive** unless a destructive change is explicitly
   approved by the business owner in writing (per this repo's production
   safety rules — see `docs/revenue-engine/PHASE0-BASELINE.md`).
3. Never edit a past migration file, even one added by mistake — add a
   new corrective migration instead (this matches the convention already
   established in the sibling Mkhsistem repository).
4. Be reviewed and explicitly approved before being applied to the live
   project via `apply_migration` — this project's database is shared with
   Mkhsistem's ~150+ production tables, so every migration here has a
   real blast radius beyond just villa's own features.
5. Be validated against live data first where relevant (e.g. checking for
   existing rows that would violate a new constraint) — see the
   "before every migration" checklist in
   `docs/revenue-engine/PHASE0-BASELINE.md`.

## Villa-owned tables as of this baseline (2026-09-04)

`units`, `bookings`, `guests`, `transactions`, `notifications`,
`housekeeping`, `villa_users`, `villa_staff`, `walkin_payments`,
`amenities`, `amenity_kit_items`, `amenity_usage_log`, `cctv_cameras`,
`cctv_checkpoint_log`, `cctv_disciplinary_reports`,
`cloudbeds_room_mapping`, `cloudbeds_events_log`, `investor_profiles`,
`opex_bulanan`, `integration_settings` (shared key/value store, not
villa-exclusive), `wa_messages_log` (shared), `cleaning_call_log`.

Two additional villa-related tables exist but are currently **unused by
any code path** (`monthly_reports`, `shift_log` — 0 rows, never
referenced by `villa-api` v25). Do not build against them without first
confirming with the owner whether they're planned-but-unbuilt or safe to
formally deprecate.

**Do not touch any table outside this list without explicit confirmation
that it is villa-owned** — this project has ~150+ tables belonging to the
separate Mkhsistem system in the same `public` schema.
