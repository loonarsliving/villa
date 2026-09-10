# CURRENT_STATE.md

_Snapshot as of this audit: 2026-08-21, `main`@`ab473b3`._

## 2026-09-10 — villa-api is now deployed from this repo via CI (NOT YET ACTIVE — needs one-time secret)
Added `.github/workflows/deploy-villa-api.yml`: pushing a change under
`supabase/functions/villa-api/` to `main` now deploys it to the live
`villa-api` Edge Function via Supabase CLI automatically. Goal (owner
request): villa-api should no longer be something edited only in the
Supabase dashboard and separately hunted down when someone needs the
source — this repo becomes the single source of truth for it, same as the
frontend. Also re-synced the previously-stale `index.ts` snapshot (was v26
from 2026-09-04, live had moved to v34) — see
`supabase/functions/villa-api/README.md` for detail on both.
**Not live yet**: the workflow needs a `SUPABASE_ACCESS_TOKEN` repo secret
(GitHub Settings → Secrets and variables → Actions) that only the owner can
add — until then the workflow will fail visibly in the Actions tab rather
than deploying. Scope explicitly does NOT cover Mkhsistem's WhatsApp/AI
bridge calls (`sendWa()`, Gemini vision) — those remain intentionally
external per owner instruction; only villa-api itself was brought in-repo.

## 2026-09-10 — Automatic monthly income sync to MKH Property (LIVE, `villa-api` v34)
Villa-api gained `POST /cron/sync-mkh-income` (deployed as version 34) plus a
new Vercel Cron (`/api/cron/sync-mkh-income`, 1st of month 09:15 WITA) that
pushes last month's rental + cafe/spa/lainnya income to MKH Property's new
`pendapatan_villa` table (a separate internal finance app/Supabase project).
See CHANGELOG.md for full detail. **Not yet observed firing for real** — the
cron hasn't run on its schedule yet as of this note, and this session's
sandbox couldn't make direct HTTPS calls to villa-api to test it manually
(network policy blocked `*.supabase.co`). Confirm after the 1st of the next
month that a row with `sumber='villa_api'` lands in MKH Property's
`pendapatan_villa`, or trigger `/api/cron/sync-mkh-income` manually with a
valid `CRON_SECRET` sooner if you want to check before then.

## Last known completed work (on `main`)
- UI redesign to a "light, colorful mobile-style theme" (merged 2026-08-18, commits `932f6de`/`54fc066`).
- Double-booking prevention by date on Front Desk (`346ab86`).
- Cloudbeds webhook moved to a Vercel Route Handler, DB-backed integration settings removed (`2ddcff5`).
- Migration from a static HTML dashboard to Next.js App Router (`bc74d1b`, `6e47839`, `8b2524a`), completed 2026-08-09.
- Full role-based system (investor/admin/receptionist dashboards) with Cloudbeds + WhatsApp integration scaffolding (`f2ffcfb`).
- Hardcoded admin token fixed, `.gitignore` added (`17ebbd8`).

## Current active work (2026-09-08, on `claude/villa-supabase-empty-db-xsadl5`)
- Fixed the reported "semuanya gagal memuat: unauthorized" on every admin page. Root cause was an expired session, not missing data: `villa-api` tokens live 7 days, the admin's `last_login` was 8d7h old, and the frontend never validated the token or handled a 401 — so the UI rendered while every request failed. Sessions now end cleanly and redirect to `/login?expired=1`. See CHANGELOG.md 2026-09-08.
- Confirmed the database is **not** empty (13 units, 19 villa_users, 5 investor_profiles, 13 cloudbeds mappings). Supabase Table Editor's row counts are stale `reltuples` estimates and had drifted to 0 for `units`, which is what made it look empty.
- **CLOSED 2026-09-08**: migration `20260908000001_enable_rls_on_exposed_villa_tables.sql` applied (owner-approved). 14 villa-owned tables (10 `villa_*` revenue tables, 3 amenities tables, `cctv_disciplinary_reports`) were readable AND writable by anyone holding the project's public anon key; RLS is now on for all of them. See DATABASE.md.

## Current active work (2026-09-01, merged to `main` and deployed)
- Investors can now fill/update a dividend bank account (`bank_nama`/`no_rekening`/`nama_pemilik_rekening`) anytime from a new `/investor/profil` page, not just once at first login. Admin's `admin/investors` table now shows each investor's rekening. A new Vercel Cron (tanggal 25, 09:00 WITA) computes the month's per-investor dividend split and sends the transfer list to every active admin account via WhatsApp. `villa-api` v25, migration `add_investor_bank_account_fields` — see ARCHITECTURE.md/DATABASE.md/CHANGELOG.md for full detail.
- Resolves the "not yet deployed to Mkhsistem production" caveat on the AI CCTV checkpoint module (below): Mkhsistem's `app/api/villa/ai/cctv-vision` bridge endpoint is now deployed to Mkhsistem's production branch (`claude/mk-connect-app-o9zw2p`) and live — the AI checkpoint module's Gemini calls should now succeed rather than fail closed. Not yet verified end-to-end against a real EZVIZ snapshot.

## Current active work (on `claude/villa-repo-construction-mapping-pi2uat`, 2026-08-27)
- Added an outbound Cloudbeds API client (`src/lib/cloudbedsApi.ts`) and a read-only `/api/admin/cloudbeds/rooms` route so the admin Cloudbeds mapping page can offer a live room picker once `CLOUDBEDS_API_KEY` is set, instead of only manual Room ID entry. Falls back to manual entry gracefully (503/error) when the key is unset — verified via `tsc --noEmit` and `next build`, not yet tested against a real Cloudbeds account (no key was provided). Room-mapping *storage* is unchanged, still owned by the external `villa-api` Edge Function.
- Added `.env.example` (previously a documented gap) listing `CLOUDBEDS_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDBEDS_API_KEY`, `CLOUDBEDS_PROPERTY_ID` — no values.
- See INTEGRATIONS.md / ENVIRONMENT.md for details.

## Current active work (open, unmerged branches)
- `claude/security-3-repos-tj69ek`: Next.js 15.1→16.3.1 CVE upgrade, Cloudbeds webhook payload validation, server-side proxy hardening for role gating.
- `claude/frigate-ai-cctv-module-eqwuri`: AI CCTV presence-detection module using EZVIZ + Gemini (via a bridge to a sibling system "Mkhsistem"), not yet on `main`.
- Several other `claude/*` branches exist (`file-hub-repo-integration`, `repo-overview`, `security-audit-repos`, `tampilan-design-request`, `villa-system-no-receptionist`) whose content was not deep-audited under this task's scope (audit focused on `main`); their existence alone signals ongoing/parallel exploratory work.

## Unfinished / not yet on `main`
- Client-side-only role gating has a known hardening branch not yet merged — production `main` currently relies solely on client-side redirect logic for route protection (server-side enforcement, if any, lives in the unaudited `villa-api`).
- Cloudbeds webhook payload validation hardening exists only on a branch, not `main`.
- Next.js dependency on `main` is version 15.1, not the CVE-patched 16.3.1 present on an unmerged branch.
- AI CCTV module is entirely absent from `main`.

## Known bugs
None explicitly documented as open/unfixed in this repo (no issue tracker content, no TODO/FIXME comments found in source). Historical "security: fix hardcoded admin token" (`17ebbd8`) indicates that class of issue was previously found and fixed on `main`.

## Technical debt
- **No automated tests** anywhere in the repo.
- **No CI/CD pipeline** (no `.github/workflows`) — quality gates before deploy are manual/best-effort only.
- **No `.env.example`** — onboarding a new developer requires reverse-engineering required env vars from source (see ENVIRONMENT.md).
- **Core backend (`villa-api`) has a manually-synced source snapshot at `supabase/functions/villa-api/index.ts`, not a live/automated one** — it is not deployed from this repo (no CI wires it to Supabase) and is not kept in sync automatically, so it drifts whenever someone deploys a `villa-api` change without also re-running the capture step in `supabase/functions/villa-api/README.md`. It had in fact drifted (last captured v26 on 2026-09-04, live had moved to v34) until re-synced 2026-09-10 in this session. Treat this file as **possibly stale** unless it was just re-synced — verify against `mcp__Supabase__get_edge_function` before trusting it for anything version-sensitive, per the villa-api verification rule in `CLAUDE.md`.
- **No database migrations tracked in git** — schema changes are presumably made ad hoc against the live Supabase project.

## Blocked work
None identified from the repo itself. UNKNOWN — NEEDS CONFIRMATION whether any of the open `claude/*` branches are blocked pending review/decisions.

## Important warnings
- **Update 2026-08-27**: `villa-api`'s source was read directly (Supabase MCP `get_edge_function`) and DOES implement real server-side session verification (HMAC-signed tokens) and role authorization (admin/staff/owner gates, 403 on mismatch) — see ARCHITECTURE.md "Backend"/"Auth / Authz". The line below (server-side auth "cannot be verified") predates that read and is now outdated for `villa-api` itself; kept for history.
- ~~Do not assume server-side authorization exists beyond what `villa-api` implements — it cannot be verified from this repo.~~
- The Cloudbeds webhook silently no-ops with 503 responses if `CLOUDBEDS_WEBHOOK_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` are missing in the Vercel environment — a misconfiguration would not crash the build, only fail silently at runtime.
- The Supabase project URL is hardcoded, not environment-driven — there is no built-in mechanism to point this app at a different Supabase project without editing source.

## Production status
Believed ACTIVE (Vercel-hosted Next.js app), based on `vercel.json` and a "fix Vercel project framework setting" commit — but no production URL is recorded in-repo to directly verify. UNKNOWN — NEEDS CONFIRMATION for a direct, current production health check.

## Mobile status
NOT IMPLEMENTED — no Capacitor/native mobile wrapper exists (see MOBILE_BUILD.md). Web-only, responsive via Tailwind breakpoints.

## Database status
Live Supabase Postgres project in use; schema/migrations are not tracked in this repository (see DATABASE.md) — status of the database itself (health, RLS coverage, backups) is UNKNOWN — NEEDS CONFIRMATION from outside this repo.
