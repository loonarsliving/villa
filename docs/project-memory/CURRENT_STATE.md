# CURRENT_STATE.md

_Snapshot as of this audit: 2026-08-21, `main`@`ab473b3`._

## Last known completed work (on `main`)
- UI redesign to a "light, colorful mobile-style theme" (merged 2026-08-18, commits `932f6de`/`54fc066`).
- Double-booking prevention by date on Front Desk (`346ab86`).
- Cloudbeds webhook moved to a Vercel Route Handler, DB-backed integration settings removed (`2ddcff5`).
- Migration from a static HTML dashboard to Next.js App Router (`bc74d1b`, `6e47839`, `8b2524a`), completed 2026-08-09.
- Full role-based system (investor/admin/receptionist dashboards) with Cloudbeds + WhatsApp integration scaffolding (`f2ffcfb`).
- Hardcoded admin token fixed, `.gitignore` added (`17ebbd8`).

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
- **Core backend (`villa-api`) is not version-controlled in this repo** — this is the single largest piece of technical/process debt found: business logic, auth enforcement, and schema live in an Edge Function whose source this repository does not track, making it impossible to audit, diff, or roll back alongside frontend changes.
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
