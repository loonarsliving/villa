# CURRENT_STATE.md

_Snapshot as of this audit: 2026-08-21, `main`@`ab473b3`._

## 2026-09-10 — Cloudbeds sync is now two-way (villa → Cloudbeds added; NOT YET ACTIVE — needs one-time secret)
`villa-api`'s `POST /bookings` now also pushes walk-in/direct bookings out
to Cloudbeds (`POST /postReservation`) so a room booked at Front Desk shows
blocked in Cloudbeds/OTAs too — until now the sync only worked one way
(Cloudbeds → villa, via the existing webhook). Root cause of the owner's
report that "staff-entered Cloudbeds data doesn't match villa" was actually
that the **inbound** webhook itself was never confirmed registered on
Cloudbeds' side (`cloudbeds_events_log` has 0 rows as of this session) —
that is still open and separate from this outbound addition; see
INTEGRATIONS.md's Cloudbeds section for both directions' detail.
**Not live yet**: needs a `CLOUDBEDS_API_KEY` Supabase Edge Function secret
on `villa-api` (separate from the same-named Vercel env var the frontend
already has) before the outbound push does anything, and separately still
needs the Cloudbeds-side webhook registration for the inbound direction to
start working, plus the `SUPABASE_ACCESS_TOKEN` CI secret noted below
before this code change even reaches production. Contract verified against
Cloudbeds' public OpenAPI spec (`github.com/cloudbeds/openapi-specs`,
`pms-v1.2`) — not guessed. Known gap: villa-side booking cancellation does
not yet push a cancellation to Cloudbeds.

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

## Pricing architecture (added 2026-09-11, all points verified against live data/code)

How a guest price is decided today:

1. **`villa_room_types.base_rate`** (Standard 650,000 / Sawah View 750,000) is
   the fixed anchor. Nothing automated writes it. `min_rate`/`max_rate`
   clamp every computed price.
2. **`/api/cron/ai-dynamic-pricing`** (00:10 WIB) computes a price per date
   from that anchor — occupancy, weekend surcharge, high season, AI
   competitor research (via Mkhsistem's bridge; outside high season the
   market average acts as a CAP, never a floor). It pushes to Cloudbeds
   **only** when `villa_pricing_settings.ai_autopush_enabled` is true
   (**currently false** per owner instruction: the live price follows
   Cloudbeds while the AI's market analysis is being evaluated). Every
   push is read back from Cloudbeds and verified date by date.
3. **`/api/cron/sync-cloudbeds-rates`** (00:25 WIB) mirrors Cloudbeds' live
   rates for **90 days** into `villa_rates` and sets `units.tarif_harian`
   to today's rate. This is the **only** writer of local price state —
   the AI engine never writes it directly, so villa and the OTAs cannot
   silently disagree.
4. **`villa-api` v39 `POST /bookings`** (both the public website endpoint
   and the staff/front-desk one) prices **every night** of a `harian`
   booking from `villa_rates`, falling back to `units.tarif_harian` only
   for a night with no row. So website, front-desk and walk-in guests are
   all charged the same published per-date price as OTA guests. `bulanan`
   stays still use `tarif_bulanan`.

Defects fixed the same day, recorded so they are not reintroduced:
- The engine used to compute from `units.tarif_harian` and write its result
  back there, compounding each run; two runs moved Standard 650,000 →
  716,500 and Sawah View 750,000 → 797,500 **upward during low occupancy**
  (weekend surcharge baked into the base: `x → 0.9x + 100,000` converges to
  `max_rate`). Fixed by the fixed `base_rate` anchor.
- `tarif_harian` was updated even when the Cloudbeds push failed, diverging
  villa's direct price from the OTA price.
- `villa_rates`' unique key was `NULLS DISTINCT` on a nullable
  `rate_plan_id`, so it did not prevent duplicate rows and `ON CONFLICT`
  upserts (including villa-api's own) would insert instead of update.
  Fixed in `20260911000002`.
- The rate mirror covered only 14 days, so bookings further out silently
  fell back to a flat rate that did not match the OTA price. Now 90 days.

**Timezone**: the villa is at Jalan Palagan, Sleman, **Yogyakarta = WIB
(UTC+7)**. The guest registration card wrongly said WITA until 2026-09-11
(a one-hour error on a signed document that sets late-checkout fees).
Cron schedules in `vercel.json` are UTC; older comments in this repo
describing them as WITA are off by one hour.

### Cloudbeds API contracts — established by live probing 2026-09-11

These cost most of a day to find because they are NOT in the OpenAPI
spec, they contradict each other, and every failure was silent. Verified
by probing one far-future date (2 & 6 Mar 2027) and reading the result
back, not by assumption:

| Behaviour | `getRate` | `putRate` |
|---|---|---|
| `endDate` | **EXCLUSIVE** — last day is not returned | **INCLUSIVE** — `[d, d]` sets exactly one night |
| `startDate == endDate` | **REJECTED**: "Parameter endDate should be greater than startDate" | **ACCEPTED** — this is how a single night is set |

Other hard-won facts:
- **Every numeric field comes back as a STRING** (`"rate":"650000.00"`).
  A `typeof x === "number"` check drops every row, and the caller sees a
  successful response with zero data. This silently broke the entire
  rate mirror from the day it was written.
- `data` may be an object or an array of rate plans — handle both.
- The nested form encoding `rates[0][interval][0][startDate]` is
  correct; a rejection here is far more likely to come from the
  `getRate` lookup that runs immediately before the push.
- `putRate` is asynchronous: it answers `202` with a `jobReferenceID`,
  so read the rate back (after a short wait) rather than trusting the
  `success: true`.

**Rule of thumb for this integration: a Cloudbeds call that "succeeds"
with empty data is the normal failure mode. Always log the raw body and
verify by reading back.**

First successful autopilot push: 2026-09-11. Fri/Sat 750,000 (Standard)
and 850,000 (Sawah View); other days at base 650,000 / 750,000, with the
occupancy discount held back until there is real booking history.

Still open: AI competitor research fails with "AI bridge failed: 200" —
Mkhsistem's `/api/villa/ai/competitor-pricing` answers 200 without
`success: true`. Until that is fixed the engine runs on occupancy,
weekend and high-season rules only, with no market data.
