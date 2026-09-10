# villa-api — Supabase Edge Function (source-controlled snapshot)

## What this is

**2026-09-10 update: this is no longer a read-only snapshot.** A GitHub
Actions workflow (`.github/workflows/deploy-villa-api.yml`) now deploys
`index.ts` in this directory to the live `villa-api` Edge Function
automatically whenever this directory changes on `main`. **This directory
is now the source of truth — do not edit `villa-api` directly in the
Supabase dashboard anymore.** A dashboard edit will silently get
overwritten the next time anything in this directory is pushed to `main`
(and will otherwise cause exactly the drift documented below, again).

One-time setup still required (not done by this commit): add a
`SUPABASE_ACCESS_TOKEN` secret in this GitHub repo's Settings → Secrets and
variables → Actions, containing a Supabase personal access token with
deploy rights on project `svcmybsziaelwwdrnzcv`. Until that secret exists,
the workflow will fail (visible in the Actions tab) rather than deploying
nothing silently.

## Provenance

| | |
|---|---|
| Supabase project | `svcmybsziaelwwdrnzcv` (`loonars-private-living`, shared with Mkhsistem) |
| Function slug | `villa-api` |
| Deployed version at capture time | **v34** (`verify_jwt: false`) |
| Captured via | Supabase MCP `get_edge_function` (read-only) |
| Captured on | 2026-09-10, this session |
| `ezbr_sha256` at capture | `a3fe3202cdce01befbea2f3cf5d1c67428afa7e9ddc9b670c9de75c1ead0b778` |

**2026-09-10 re-sync note:** this snapshot had drifted — it was last captured
at v26 (2026-09-04) and the live function had since moved to v34 without a
matching snapshot update (the "Keeping this snapshot current" step below was
skipped across v27–v33). Re-fetched and re-synced now; the diff against the
old v26 file was a clean 192-line addition with no removed/altered lines,
consistent with the incremental features documented in `CURRENT_STATE.md`
(dividend bank account fields, RLS hardening endpoints, MKH Property income
sync `/cron/sync-mkh-income`, etc.) landing between v26 and v34. The
intermediate v27–v33 diffs themselves were never captured and cannot be
reconstructed. **Lesson: this file is only trustworthy immediately after a
deploy — treat it as possibly stale otherwise, and re-run the sync step
below before relying on it, especially before debugging "why doesn't the
code do X" against outdated source.**

**v26 deployed 2026-09-04** (owner-approved): atomic check-in/checkout via
new RPCs, server-side pricing for new walk-in/direct bookings,
constant-time auth signature comparison, live role/active-state
revalidation, date validation, minimum 8-char admin-set passwords. Full
change-by-change rationale in `phase1-draft/CHANGES.md` (kept as the
historical record of what changed and why — the code itself has been
merged into this file). Deployed source was re-fetched and diffed
against the reviewed draft after deploy; they matched exactly
(`ezbr_sha256` above).

This function is **not** deployed from a GitHub Actions workflow or any CI
in this repo. Historically, schema/function changes have been applied
directly against the live Supabase project by whichever session was doing
the work at the time (see `docs/revenue-engine/PHASE0-BASELINE.md`), with
no corresponding file ever committed here until now.

## Why this matters

Before this snapshot, `villa-api`'s ~450-line, ~45-route source existed
**only** as a live deployment — unreviewable, undiffable, and with no way
to roll back a bad change except by hand-editing the function again inside
Supabase. This snapshot is Phase 0 of the roadmap in
`docs/revenue-engine/PHASE0-BASELINE.md`: it does not change any behavior,
it only makes the existing behavior reviewable in git going forward.

## Deploying a change (current process, since the 2026-09-10 CI workflow)

1. Edit `index.ts` in this directory, on a branch.
2. Get explicit sign-off per this repo's `docs/revenue-engine/` production
   safety rules — this function serves live bookings and real investor
   payout calculations.
3. Merge/push to `main`. `.github/workflows/deploy-villa-api.yml` deploys
   it to project `svcmybsziaelwwdrnzcv` automatically — no manual
   `supabase functions deploy` or MCP `deploy_edge_function` call needed
   (and none should be run directly against Supabase outside this flow,
   or the repo and the live function will drift again).
4. Check the workflow run in the GitHub Actions tab to confirm it
   succeeded. If it's red, `villa-api` was **not** updated in production —
   treat that the same as a failed Vercel build, not a soft failure.
5. Record the change in `docs/revenue-engine/PHASE0-BASELINE.md`'s
   changelog section (or a dedicated CHANGELOG once one exists).

If you ever suspect drift anyway (e.g. someone bypassed this and deployed
by hand), re-fetch via Supabase MCP `get_edge_function` and diff against
this file before trusting either one.

## Runtime environment variables (names only — no values, never commit values)

See `docs/revenue-engine/PHASE0-BASELINE.md` → "Environment variables"
for the full list and purpose of each. Values live only in the Supabase
project's Edge Function secrets, never in this repository.
