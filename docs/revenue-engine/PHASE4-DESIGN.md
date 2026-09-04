# Phase 4 (partial) — Daily Inventory Snapshot

Status: **migration APPLIED to production 2026-09-04** (table exists
live now); **cron route not yet live** — it ships in this repo's Next.js
code, which only reaches production once this branch merges to `main`
(Vercel deploys from `main` only, per this repo's existing flow). So the
table is ready to receive rows, but nothing writes to it until merge.
This is the one item the program explicitly calls out as "harus dimulai
sedini mungkin" (§7 / §27) since the data clock cannot be backfilled —
**recommend merging this branch (or at least this cron route) to `main`
soon** so snapshot collection actually starts, rather than waiting for
every other phase to also be ready.

## What's included

- `supabase/migrations/20260904000004_daily_inventory_snapshot.sql` —
  `villa_daily_inventory_snapshot` table, one row per (date, unit),
  **not applied yet** (same as every other migration in this program).
- `src/app/api/cron/daily-inventory-snapshot/route.ts` — computes
  "today" in `Asia/Jakarta` (not server UTC — matters at the day
  boundary), reads every unit's current `status` plus whether it has an
  active booking covering today, and upserts one row per unit. Idempotent
  by design (`onConflict: 'snapshot_date,unit_id'`) — a manual re-run or
  a Vercel retry the same day overwrites, never duplicates.
- `vercel.json` — new daily cron entry, `55 15 * * *` UTC = 23:55 WITA
  (captures end-of-day state).

## ⚠️ Needs verification before merge — Vercel cron count

This project's own history (`docs/project-memory/CHANGELOG.md`,
2026-08-31 entry) records a real incident: adding a 2-hourly CCTV cron
once exceeded Vercel Hobby's cron limits and **silently blocked every
subsequent deploy** until the schedule was changed to once-daily. All
four crons in `vercel.json` (including this new one) now run at most
once daily, which satisfies the *frequency* limit that caused that
incident — but whether Hobby also caps the *total number* of cron jobs
per project was not independently re-verified this session. **Before
merging this to `main`, confirm on the actual Vercel project/plan that a
4th cron doesn't hit a different limit** — the failure mode observed
before was a blocked deploy, not a crash, so it's recoverable but should
be checked rather than assumed.

## What's NOT included yet

- No historical backfill (impossible — this table only knows about "now"
  going forward, exactly as intended).
- `room_type_id` on each snapshot row will be NULL until Phase 3's
  `units.room_type_id` is actually populated (open owner question, see
  `PHASE3-DESIGN.md`) — the snapshot still captures unit-level and
  villa-wide occupancy correctly without it; the room-type breakdown
  just won't be usable until that's resolved.
- No pickup/pace computation yet (Phase 4's other half, §11 of the
  mandate) — that's a read/aggregation layer over this table plus
  `bookings.created_at`, planned as Phase 5 work once enough days of
  snapshots and normalized bookings exist to be meaningful.

## Testing

- `npm run build` / `npm test` — clean (see commit).
- Manual test before relying on it: once `CRON_SECRET` is set and the
  migration applied, hit `/api/cron/daily-inventory-snapshot` directly
  with the correct `Authorization: Bearer` header and confirm the
  response's `occupancy_pct` matches the current Front Desk dashboard's
  numbers.
