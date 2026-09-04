# Phase 1 — Security + Data Integrity (design, drafted; NOT applied to production)

Status: **design + draft code complete, written for review. Nothing in
this phase has been applied to the live database or deployed to
`villa-api`.** Applying/deploying requires explicit owner confirmation
per the program's production-safety rules — this phase touches booking
creation, check-in, and check-out, the paths that serve real guests.

## What's in this phase

| Item | File(s) | Status |
|---|---|---|
| §6.1 Double-booking DB protection | `supabase/migrations/20260904000001_booking_exclusion_constraint.sql` | Written, not applied |
| §6.1 Read-only conflict scan (prerequisite) | — (query run directly, see PHASE0 changelog) | **Done**: 0 conflicts found |
| §6.2/§6.3 Atomic check-in/checkout RPCs | `supabase/migrations/20260904000002_atomic_checkin_checkout_rpc.sql` | Written, not applied |
| §6.4 Server-side pricing for new bookings | `supabase/functions/villa-api/phase1-draft/index.ts` (`POST /bookings`) | Drafted, not deployed |
| §6.5 Date/enum validation | Same file, `isValidDateStr()` + enum checks | Drafted, not deployed |
| §6.6 Constant-time auth comparison | Same file, `verifyToken()` | Drafted, not deployed |
| §6.6 Live role/active-state revalidation | Same file, `requireAuth()` | Drafted, not deployed |
| §6.7 RLS on 4 disabled villa tables | — | **Not started** — see "RLS" below |

Every change is documented function-by-function in
`supabase/functions/villa-api/phase1-draft/CHANGES.md`, including exact
before/after code and which behaviors intentionally change vs. stay
identical.

## Why §6.5 doesn't use Zod

The mandate asks for centralized validation "gunakan Zod atau
equivalent." `villa-api` is a Deno Edge Function; Zod is importable there
via `npm:zod`, but for the ~6 fields actually validated in this phase
(two date strings, one enum, one price sanity check), adding a schema
library is more surface area than the problem needs right now. Plain
guard functions (`isValidDateStr`, inline `.includes()` enum checks) are
used instead, matching the file's existing style. If Phase 3+ adds
materially more input surface (rate plans, promotions, restrictions),
revisit this — a growing pile of ad hoc checks is exactly when a schema
library starts paying for itself. Flagging this as a deliberate,
reversible choice, not an oversight.

## RLS on `amenities` / `amenity_kit_items` / `amenity_usage_log` / `cctv_disciplinary_reports`

**Not started this phase**, per the mandate's own explicit instruction
(§6.7 / §45): "Jangan langsung enable RLS... Design policies. Test
policies... Baru kemudian enable RLS." This requires first enumerating
every access path to these four tables (villa-api's service-role access,
which must keep working; any direct frontend/anon-key access, which this
audit has found no evidence of but hasn't exhaustively ruled out at the
RLS-policy level; and the webhook route, which never touches these
tables). This is real, separate design work — proposed as the tail end
of Phase 1 once the migrations above are reviewed, not bundled into this
first pass.

## Deployment sequencing (once approved)

1. Apply `20260904000001_booking_exclusion_constraint.sql` — re-run the
   read-only conflict scan immediately before, since time will have
   passed since the 2026-09-04 baseline.
2. Apply `20260904000002_atomic_checkin_checkout_rpc.sql`.
3. Verify both via `list_migrations` / a direct `select` against
   `pg_constraint`/`pg_proc` — confirm they're live before touching
   `villa-api`.
4. Deploy `supabase/functions/villa-api/phase1-draft/index.ts` as v26 via
   `deploy_edge_function`.
5. Re-fetch via `get_edge_function`, diff against the reviewed draft,
   confirm they match exactly.
6. Run the manual verification checklist in `phase1-draft/CHANGES.md`.
7. Replace `supabase/functions/villa-api/index.ts` (the "deployed
   snapshot") with the now-live v26 source, update its README's "current
   version" line, commit.
8. Update `PHASE0-BASELINE.md`'s changelog.

## Explicitly out of scope for this phase

- Cloudbeds API capability confirmation (§16 of the master mandate) —
  independent of Phase 1, tracked separately, still an open blocker for
  Phase 2/9B.
- Any change to `computeReport()`, the 70/30 split, marketing/opex %, or
  the guarantee — untouched, per the frozen baseline.
- Pagination, promotions, room types, channels, rate plans — later
  phases.
