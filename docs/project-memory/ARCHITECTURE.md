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
- **In this repo**: exactly one server-side route: `src/app/api/webhooks/cloudbeds/route.ts` — a Next.js Route Handler (`runtime = "nodejs"`, `dynamic = "force-dynamic"`) that receives Cloudbeds webhook POSTs, validates a shared secret with a timing-safe comparison, and writes directly to Supabase using the service-role key.
- **Everything else (login, CRUD for units/bookings/transactions/reports/users/staff/notifications/housekeeping/Cloudbeds mapping/WA log)**: routed through a single Supabase Edge Function `villa-api`, called from the browser at a hardcoded URL. **Its source is not in this repository** — UNKNOWN — NEEDS CONFIRMATION where that code lives, its language/runtime, and its full route table (only inferred from client call sites, listed below).

### Inferred `villa-api` route surface (from client call sites only — not verified against actual server code)
`POST /login`, `POST /me/password`, `POST /me/investor-profile`, `GET /admin/overview`, `GET/POST/PATCH/DELETE /admin/cloudbeds/mapping`, `GET /admin/cloudbeds/log`, `GET /units`, `GET/POST/PATCH /admin/staff`, `GET/POST/PATCH /admin/users`, `GET /admin/wa/log`, `GET /bookings`, `GET/PATCH /housekeeping`, `GET /notifications`, `PATCH /notifications/read`, `GET /report`, `GET /transactions`. This list is a description of observed client requests, not a guarantee of the server's actual implementation.

## Database
- **Supabase** Postgres, project URL `https://svcmybsziaelwwdrnzcv.supabase.co` (hardcoded in two places: `src/lib/api.ts` and `src/app/api/webhooks/cloudbeds/route.ts`).
- **No `supabase/` directory, no migration files, and no schema definitions exist in this repository.** Table/column names are only inferable from TypeScript types (`src/lib/types.ts`) and the Cloudbeds webhook's direct table writes (`cloudbeds_room_mapping`, `guests`, `bookings`, `notifications`, `cloudbeds_events_log`). See DATABASE.md. UNKNOWN — NEEDS CONFIRMATION for full schema, RLS policies, triggers, views, and RPC functions — none of that is present in-repo.

## Auth / Authz
- **Auth is NOT Supabase Auth** in the client — the app calls a custom `/login` endpoint on `villa-api`, receives a `{ token, user }` payload, and stores both in `localStorage` (`villa_token`, `villa_user`). All subsequent API calls attach the token as a custom header `x-villa-token` (`src/lib/api.ts`).
- **Authorization / route protection on the client is role-gating only**, implemented in `src/lib/auth.tsx`'s `AuthProvider`: on mount it reads `localStorage`, redirects to `/login` if no token/user, and redirects to the user's role home if `requireRole` doesn't include the user's role. This is a client-side check — it does not by itself prevent an unauthenticated/wrong-role browser from briefly rendering, or from calling `villa-api` directly with a stolen/guessed token; real enforcement, if any, must live server-side in `villa-api`, which is unauditable from this repo. UNKNOWN — NEEDS CONFIRMATION: server-side auth/authz enforcement inside `villa-api`.
- A separate unmerged branch (`claude/security-3-repos-tj69ek`, commit `1657dfb` "Harden client-side role gating with server-side proxy...") suggests this exact gap was identified and addressed in a branch not yet merged to `main`. Not evaluated further per audit-only scope.
- The Cloudbeds webhook route authenticates via a shared secret (`CLOUDBEDS_WEBHOOK_SECRET`) compared with `crypto.timingSafeEqual`, and authorizes its Supabase writes using the `SUPABASE_SERVICE_ROLE_KEY` (full DB access, bypasses RLS).

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
