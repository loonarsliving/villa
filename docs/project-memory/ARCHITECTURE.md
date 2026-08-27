# ARCHITECTURE.md

All claims below are grounded in files under `/home/user/villa` at commit `ab473b3` (branch `main`) unless marked otherwise.

## High-level shape
```
Browser (Next.js client components)
   │  fetch() with x-villa-token header, base URL hardcoded in src/lib/api.ts
   ▼
Supabase Edge Function "villa-api"   <-- NOT IN THIS REPO (source UNKNOWN)
   │
   ▼
Supabase Postgres (project ref svcmybsziaelwwdrnzcv)

Separately:
Cloudbeds (external SaaS) --webhook--> /api/webhooks/cloudbeds (Next.js Route Handler, this repo)
                                          │ (service-role key)
                                          ▼
                                     Supabase Postgres (direct, via @supabase/supabase-js)
```

## Frontend
- **Framework**: Next.js 15.1 (App Router), React 19, TypeScript, Tailwind CSS 3. (`package.json`, `next.config.mjs`, `tailwind.config.ts`)
- **Structure**: `src/app/{admin,front-desk,investor}` each has a `layout.tsx` + `_shell.tsx` (role-specific nav wrapper around a shared `src/components/DashboardShell.tsx`) and per-feature `page.tsx` files. All pages audited are `"use client"` components.
- **Shared components**: `Card.tsx`, `Modal.tsx`, `StatCard.tsx`, `DashboardShell.tsx` (`src/components/`).
- **Shared lib**: `src/lib/api.ts` (fetch wrapper + auth header), `auth.tsx` (React context, role-gate redirect, reads `localStorage`), `format.ts` (currency/date formatting, Indonesian locale `id-ID`), `hooks.ts` (`useNotifPoll` — polls `/notifications` every 30s), `toast.tsx`, `types.ts` (all domain types).
- No server components performing data fetching were found — all data fetching is client-side via `api.get/post/patch/delete`.

## Backend
- **In this repo**: two server-side routes: `src/app/api/webhooks/cloudbeds/route.ts` (Cloudbeds webhook receiver, service-role key) and, added 2026-08-27, `src/app/api/admin/cloudbeds/rooms/route.ts` (read-only proxy to Cloudbeds' own `getRooms` API, `CLOUDBEDS_API_KEY`-gated — see INTEGRATIONS.md).
- **Everything else (login, CRUD for units/bookings/transactions/reports/users/staff/notifications/housekeeping/Cloudbeds mapping/WA log)**: routed through a single Supabase Edge Function `villa-api`, called from the browser at a hardcoded URL.

**Update 2026-08-27 — `villa-api` source read directly via Supabase MCP (`get_edge_function`, project `svcmybsziaelwwdrnzcv`, currently deployed version 18). It is a single Deno/TypeScript `index.ts` (~450 lines), not a framework — one big `Deno.serve` handler with manual `path`/method matching.** This replaces prior "UNKNOWN — source not visible" notes below with verified facts:

- **Session auth is real and server-enforced**, not just client-side gating: `/login` calls a `villa_login` Postgres RPC, then issues a custom HMAC-SHA256-signed token (`base64url(payload).base64url(hmac)`, 7-day TTL, secret = `VILLA_SESSION_SECRET` env var on the Edge Function side — fails closed with 503 if unset, no hardcoded fallback). Every non-public route calls `requireAuth()` (reads `x-villa-token`, verifies signature + expiry) and then gates by role (`isAdmin`/`isStaff`/`isOwner`) with `forbidden()` (403) — e.g. everything under `/admin/*` requires `isAdmin`. **The "no server-side auth, only client-side redirect" claim elsewhere in this file/CURRENT_STATE.md is now confirmed WRONG for `villa-api` itself** — real authz exists there; what's still unverified is only whether the unmerged `claude/security-3-repos-tj69ek` branch's "harden client-side role gating" work addresses a *different* gap (e.g. this Next.js frontend calling `villa-api` directly bypassing app-level checks) — not re-audited here.
- **villa-api has its OWN, separate Cloudbeds webhook receiver**: `POST /villa-api/webhook/cloudbeds`, secret read from `integration_settings` table (key `cloudbeds`, field `webhook_secret`) rather than an env var. Confirmed via direct query (2026-08-27): **no `cloudbeds` row currently exists in `integration_settings`**, so this endpoint is dead/unconfigured — the actively used Cloudbeds webhook is this repo's own `/api/webhooks/cloudbeds` (env-var-secret-based). Two parallel, differently-configured Cloudbeds webhook implementations exist; only one is live. Do not configure the `integration_settings.cloudbeds.webhook_secret` key without understanding this collision.
- **WhatsApp sending mechanism confirmed**: `villa-api`'s `sendWa()` does NOT call any WhaCenter API directly. It reads `integration_settings` key `vercel_bridge` (`base_url` + `secret`) and POSTs to `${base_url}/api/wa/send` with header `x-internal-secret`. Confirmed via direct query (2026-08-27): `vercel_bridge.base_url = https://mkh.haluoleo.id` — **this is the sibling "Mkhsistem" (MK Connect) system**. So Villa does not own or implement WhatsApp sending at all; it borrows Mkhsistem's `/api/wa/send` endpoint. Every notification (`checkin` PIN, cleaning-service dispatch, manual `/wa/send`) logs its outcome to `wa_messages_log` regardless of success (`sent`/`failed`/`error`/`skipped_*`).
- No AI/Gemini call exists anywhere in the currently deployed `villa-api` v18 — consistent with AI_AND_AGENTS.md's existing note that AI (also routed through Mkhsistem, per the unmerged CCTV branch) is not live on `main`.
- There IS a cron endpoint: `POST /cron/cleaning-calls` (secret via `integration_settings.cron.secret`, header `x-cron-secret`) — dispatches a WA message (via the Mkhsistem bridge above) to active cleaning-service staff ~3h before a scheduled check-in. Not previously documented in this file.

### Confirmed `villa-api` route surface (read directly from deployed source, 2026-08-27 — supersedes the older "inferred from client call sites" list)
`POST /login`, `POST /me/password`, `POST /me/investor-profile`, `GET /bridge/occupancy` (internal-secret-gated), `POST /webhook/cloudbeds` (unconfigured/dead, see above), `POST /cron/cleaning-calls` (cron-secret-gated), `GET/POST/PATCH /walkin-payments`, `GET/POST /walkin-qris`, `GET/POST /admin/settings`, `GET/POST/PATCH /admin/users`, `GET /admin/investors`, `GET/POST/PATCH/DELETE /admin/staff`, `GET/POST/DELETE /admin/cloudbeds/mapping`, `GET /admin/cloudbeds/log`, `GET /admin/wa/log`, `GET /admin/overview`, `POST /wa/send`, `GET/PATCH /units`, `GET /summary`, `GET/POST/PATCH /bookings`, `GET /availability`, `POST /checkin`, `POST /checkout`, `GET /housekeeping`, `PATCH /housekeeping/done`, `GET /notifications`, `PATCH /notifications/read`, `GET /transactions`, `GET/POST /opex`, `GET /report`.

## Database
- **Supabase** Postgres, project URL `https://svcmybsziaelwwdrnzcv.supabase.co` (hardcoded in two places: `src/lib/api.ts` and `src/app/api/webhooks/cloudbeds/route.ts`).
- **No `supabase/` directory, no migration files, and no schema definitions exist in this repository.** Table/column names are only inferable from TypeScript types (`src/lib/types.ts`) and the Cloudbeds webhook's direct table writes (`cloudbeds_room_mapping`, `guests`, `bookings`, `notifications`, `cloudbeds_events_log`). See DATABASE.md. UNKNOWN — NEEDS CONFIRMATION for full schema, RLS policies, triggers, views, and RPC functions — none of that is present in-repo.

## Auth / Authz
- **Auth is NOT Supabase Auth** in the client — the app calls a custom `/login` endpoint on `villa-api`, receives a `{ token, user }` payload, and stores both in `localStorage` (`villa_token`, `villa_user`). All subsequent API calls attach the token as a custom header `x-villa-token` (`src/lib/api.ts`).
- **Client-side**: role-gating only, implemented in `src/lib/auth.tsx`'s `AuthProvider` — reads `localStorage`, redirects to `/login` if no token/user, redirects to the user's role home if `requireRole` doesn't match. This alone would not stop a stolen/guessed token being used directly against `villa-api`.
- **Server-side (CONFIRMED 2026-08-27, see "Backend" above): real enforcement exists in `villa-api` itself** — HMAC-signed session tokens verified server-side (`requireAuth`), then role-checked (`isAdmin`/`isStaff`/`isOwner`) per route with `forbidden()` (403) on mismatch. The earlier "server-side enforcement is UNKNOWN/unauditable" note in this file and in CURRENT_STATE.md was written when `villa-api`'s source hadn't been read — it has been now, via Supabase MCP `get_edge_function`, and the enforcement is real.
- The unmerged branch `claude/security-3-repos-tj69ek` (commit `1657dfb`) is therefore hardening the *frontend's own* proxying/gating, not compensating for a missing backend check — re-confirm its exact motivation before assuming it's closing a critical hole.
- The Cloudbeds webhook route (this repo) authenticates via a shared secret (`CLOUDBEDS_WEBHOOK_SECRET`) compared with `crypto.timingSafeEqual`, and authorizes its Supabase writes using the `SUPABASE_SERVICE_ROLE_KEY` (full DB access, bypasses RLS). `villa-api` has a second, currently-unconfigured Cloudbeds webhook of its own — see "Backend" above.

## API
- Client → `villa-api`: JSON over HTTPS, custom header-based auth (see above). No OpenAPI/schema file exists in-repo.
- External → this app: one REST-ish webhook endpoint, `POST /api/webhooks/cloudbeds`.

## Repositories / Services / Workers
No repository/service-layer abstraction, background worker, queue, or cron job exists in this codebase. All "business logic" client-side is just page components calling the shared `api` object. Any service/repository pattern would live inside the unaudited `villa-api` Edge Function.

## AI
No AI/LLM integration exists on `main`. See AI_AND_AGENTS.md for the unmerged branch that adds one.

## Integrations
See INTEGRATIONS.md for full detail. Summary: Supabase (DB + edge functions), Cloudbeds (OTA/channel manager, webhook), Vercel (hosting), and (per git history, not verifiable in current source) a WhatsApp sending integration called "WhaCenter" referenced by commit messages and the `admin/wa-log` UI page — no WhaCenter client code exists in this repo; sending presumably happens inside `villa-api`.

## Data flow (typical booking-from-Cloudbeds flow, as coded)
1. Cloudbeds fires a webhook to `/api/webhooks/cloudbeds` on a reservation create/update event.
2. Route validates `x-cloudbeds-secret` header against `CLOUDBEDS_WEBHOOK_SECRET`.
3. Looks up `cloudbeds_room_mapping` for the reservation's `roomId` to find the internal `unit_id`.
4. If matched: inserts a `guests` row, upserts a `bookings` row (`onConflict: cloudbeds_reservation_id`), inserts a `notifications` row targeting `all` roles.
5. Always logs the raw event to `cloudbeds_events_log` (matched or not, with error if any).
6. Front Desk / Admin pages later read this data back out through `villa-api` (not directly from Postgres).
