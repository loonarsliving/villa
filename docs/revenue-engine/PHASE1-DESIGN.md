# Phase 1 — Security + Data Integrity

Status: **APPLIED / DEPLOYED to production 2026-09-04 (owner-approved),
except §6.7 (RLS).** Migrations applied, `villa-api` redeployed as v26,
deployed source re-fetched and diff-verified to match exactly.

## What's in this phase

| Item | File(s) | Status |
|---|---|---|
| §6.1 Double-booking DB protection | `supabase/migrations/20260904000001_booking_exclusion_constraint.sql` | **Applied** |
| §6.1 Read-only conflict scan (prerequisite) | — (query run twice: Phase 0 baseline, and immediately pre-apply) | **Done**: 0 conflicts found both times |
| §6.2/§6.3 Atomic check-in/checkout RPCs | `supabase/migrations/20260904000002_atomic_checkin_checkout_rpc.sql` | **Applied** |
| §6.4 Server-side pricing for new bookings | `supabase/functions/villa-api/index.ts` (`POST /bookings`) | **Deployed** (v26) |
| §6.5 Date/enum validation | Same file, `isValidDateStr()` + enum checks | **Deployed** (v26) |
| §6.6 Constant-time auth comparison | Same file, `verifyToken()` | **Deployed** (v26) |
| §6.6 Live role/active-state revalidation | Same file, `requireAuth()` | **Deployed** (v26) |
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

## Deployment sequencing — completed 2026-09-04

1. ✅ Re-ran the read-only conflict scan immediately before applying — 0
   conflicts (same as the Phase 0 baseline check).
2. ✅ Applied `20260904000001_booking_exclusion_constraint.sql`.
3. ✅ Applied `20260904000002_atomic_checkin_checkout_rpc.sql`.
4. ✅ Verified both via `list_migrations`.
5. ✅ Deployed `villa-api` as v26 via `deploy_edge_function`
   (`verify_jwt: false` preserved — confirmed explicitly, since the
   default is `true` and would have broken every request had it been
   left unset).
6. ✅ Re-fetched via `get_edge_function`, diffed against the reviewed
   source — matched exactly (`ezbr_sha256`
   `c1184511bf252121de5b4a1efda4a22effd698ec1343b07a0d0d3f71c2722895`).
7. ⚠️ **Not done**: a live functional smoke test (e.g. an actual
   `/login` call) — this session's network egress to
   `*.supabase.co` is blocked by the environment's proxy policy, so no
   HTTP call could be made from here. The deploy is verified
   structurally (source matches, function is ACTIVE, config preserved)
   but **not yet verified behaviorally**. Recommend the owner/staff do
   one real login + one real check-in on a test booking before treating
   this as fully confirmed working.
8. ✅ Replaced `supabase/functions/villa-api/index.ts` with the live v26
   source; updated its README; `phase1-draft/index.ts` removed
   (superseded), `phase1-draft/CHANGES.md` kept as the historical
   rationale record.
9. ✅ Updated `PHASE0-BASELINE.md`'s changelog.

## Explicitly out of scope for this phase

- Cloudbeds API capability confirmation (§16 of the master mandate) —
  independent of Phase 1, tracked separately, still an open blocker for
  Phase 2/9B.
- Any change to `computeReport()`, the 70/30 split, marketing/opex %, or
  the guarantee — untouched, per the frozen baseline.
- Pagination, promotions, room types, channels, rate plans — later
  phases.
