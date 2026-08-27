# INTEGRATIONS.md

No secrets, keys, tokens, or credentials are recorded below — purpose/location/status only.

## Supabase
- **Purpose**: Primary database (Postgres) and, via an Edge Function, the app's entire application/business-logic backend.
- **Location in code**: `src/lib/api.ts` (frontend → `villa-api` Edge Function calls); `src/app/api/webhooks/cloudbeds/route.ts` (direct Postgres writes via `@supabase/supabase-js`, service-role key).
- **Data IN**: query params / JSON bodies for CRUD requests from every page; Cloudbeds webhook payload data for direct writes.
- **Data OUT**: JSON responses consumed by all pages; rows written by the webhook route.
- **Authentication method**: Frontend → `villa-api`: custom bearer-like header `x-villa-token` (app-issued token from `/login`, not Supabase Auth). Webhook route → Postgres: Supabase **service role key** (`SUPABASE_SERVICE_ROLE_KEY` env var, Vercel-only per code comment).
- **Status**: ACTIVE — used throughout the app; is the sole data store.
- **Dependencies**: `@supabase/supabase-js` (^2.47.0).
- Note: `villa-api` Edge Function source is not in this repo — UNKNOWN — NEEDS CONFIRMATION on its own dependencies/auth internals.

## Cloudbeds (channel manager / OTA distribution)
- **Purpose**: Syncs external booking-channel (OTA) reservations and room availability into the app as a "channel manager" only — no smart-lock/physical access trigger.
- **Location in code**: `src/app/api/webhooks/cloudbeds/route.ts` (inbound webhook receiver); `src/lib/cloudbedsApi.ts` + `src/app/api/admin/cloudbeds/rooms/route.ts` (outbound Cloudbeds API client, read-only `getRooms` proxy — added 2026-08-27); `src/app/admin/cloudbeds/page.tsx` (room-mapping admin UI, now with a live room picker sourced from the outbound client, falling back to manual Room ID entry when the key is unset or the call fails + event log viewer).
- **Data IN (webhook)**: webhook JSON payload (`event`/`eventType`, `reservation`/`data` with roomId, reservationId, guest name/phone, dates, total, length-of-stay).
- **Data OUT (webhook)**: writes to `bookings`, `guests`, `notifications`, `cloudbeds_events_log` tables.
- **Data IN/OUT (outbound API)**: calls Cloudbeds' `GET /api/v1.2/getRooms`; returns room id/name/room-type to the admin mapping UI only — writes nothing.
- **Authentication method**: Webhook: shared secret in `x-cloudbeds-secret` header, compared with `crypto.timingSafeEqual` against `CLOUDBEDS_WEBHOOK_SECRET` env var. Outbound API: Cloudbeds self-service property-level API key sent as `x-api-key` header (`CLOUDBEDS_API_KEY` env var; per Cloudbeds' own docs this key is long-lived, no OAuth refresh needed).
- **Status**: Webhook receiver ACTIVE on `main` (moved here from a DB-backed/Edge-Function pattern per commit `2ddcff5`). Payload validation hardening exists only on unmerged branch `claude/security-3-repos-tj69ek` — NOT yet on `main`. Outbound API client/live room picker: code is in place and builds clean, but **inert until the owner sets `CLOUDBEDS_API_KEY` in Vercel** — not yet exercised against a real Cloudbeds account from this repo.
- **Room-mapping storage**: unchanged — `POST/GET/DELETE /admin/cloudbeds/mapping` still goes through the external `villa-api` Edge Function (not this repo); the live picker only changes where the Room ID/Name values in that form come from.
- **Dependencies**: `@supabase/supabase-js`, Node `crypto`, native `fetch` (no new npm package added for the Cloudbeds API client).

## Vercel
- **Purpose**: Hosting/deployment platform for the Next.js app.
- **Location in code**: `vercel.json` (`{"framework": "nextjs"}`); commit `d203c7f` "chore: trigger redeploy after fixing Vercel project framework setting" confirms an actual Vercel project exists and has been operated on.
- **Data IN/OUT**: N/A (hosting, not a data integration).
- **Authentication method**: N/A from repo (Vercel project/GitHub App linkage is external to this repo).
- **Status**: ACTIVE (see DEPLOYMENT.md).
- **Dependencies**: none in-repo beyond standard Next.js build.

## WhatsApp sending ("WhaCenter") — referenced, not present in code
- **Purpose** (inferred from git history/commit messages): sending WhatsApp notifications/PIN codes to guests and staff.
- **Location in code**: **NONE found in current `main` tree.** Only indirect evidence: `src/app/admin/wa-log/page.tsx` (a read-only log viewer calling `GET /admin/wa/log`), and historical commit messages (`71552b2` "Tambah panel Super Admin, integrasi Cloudbeds (OTA) & WhaCenter (WA+PIN kamar)", `01bcad3` "Pindahkan kredensial Cloudbeds & WhaCenter ke Vercel Environment Variables", `32d6ff5` "...log real WA send results").
- **Data IN/OUT**: UNKNOWN — NEEDS CONFIRMATION (no client code in this repo).
- **Authentication method**: UNKNOWN — NEEDS CONFIRMATION (git history implies credentials were moved to Vercel env vars at some point, but no matching `process.env.*` reference for a WhatsApp/WhaCenter key exists anywhere in the current tree).
- **Status**: UNKNOWN — likely implemented inside the unaudited `villa-api` Edge Function, not verifiable from this repository.

## Meta / Ads Manager / OTA (other than Cloudbeds) / Google / payment / storage / email
No code, env var reference, or dependency evidence for any of these was found anywhere in this repository. NOT IMPLEMENTED (in this repo) / UNKNOWN whether implemented in the external `villa-api` Edge Function.

## Gemini / AI (Google)
See AI_AND_AGENTS.md — not present on `main`; exists only on an unmerged branch.
