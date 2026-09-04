# villa-api — Supabase Edge Function (source-controlled snapshot)

## What this is

This directory is a **read-only snapshot** of the `villa-api` Supabase Edge
Function's deployed source, captured for review/version-control purposes.
It is **not automatically deployed** by any build step in this repository —
`index.ts` here has no effect on production until someone explicitly runs
`supabase functions deploy villa-api` (or the equivalent MCP
`deploy_edge_function` call) against project `svcmybsziaelwwdrnzcv`.

## Provenance

| | |
|---|---|
| Supabase project | `svcmybsziaelwwdrnzcv` (`loonars-private-living`, shared with Mkhsistem) |
| Function slug | `villa-api` |
| Deployed version at capture time | **v25** (`verify_jwt: false`) |
| Captured via | Supabase MCP `get_edge_function` (read-only) |
| Captured on | 2026-09-04, this session |
| `ezbr_sha256` at capture | `1b77d7b6ccf05da60521c9256d49900f1f1331ca89447ef3a6558ef87c395309` |

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

## Keeping this snapshot current

Whenever `villa-api` is redeployed (a new version), re-run:

```
mcp: Supabase.get_edge_function(project_id="svcmybsziaelwwdrnzcv", function_slug="villa-api")
```

and commit the updated `index.ts` **in the same commit/PR** as the change
description, so the deployed version and the tracked source never drift
silently out of sync. Bump the "Deployed version at capture time" line
above and note the new `ezbr_sha256`.

## Deploying a future change

1. Edit `index.ts` in this directory.
2. Get explicit sign-off per this repo's `docs/revenue-engine/` production
   safety rules — this function serves live bookings and real investor
   payout calculations.
3. Deploy via Supabase MCP `deploy_edge_function` (or `supabase functions
   deploy villa-api` with the CLI) pointing at project
   `svcmybsziaelwwdrnzcv`.
4. Immediately re-fetch via `get_edge_function` and diff against what was
   just deployed, to confirm the deployed artifact matches the reviewed
   source exactly.
5. Record the change in `docs/revenue-engine/PHASE0-BASELINE.md`'s
   changelog section (or a dedicated CHANGELOG once one exists).

## Runtime environment variables (names only — no values, never commit values)

See `docs/revenue-engine/PHASE0-BASELINE.md` → "Environment variables"
for the full list and purpose of each. Values live only in the Supabase
project's Edge Function secrets, never in this repository.
