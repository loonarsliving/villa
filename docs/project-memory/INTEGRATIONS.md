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
- **Status**: Webhook receiver ACTIVE on `main` (moved here from a DB-backed/Edge-Function pattern per commit `2ddcff5`). Payload validation hardening exists only on unmerged branch `claude/security-3-repos-tj69ek` — NOT yet on `main`. Outbound API client/live room picker: code is in place and builds clean, but **inert until the owner sets `CLOUDBEDS_API_KEY` in Vercel** — not yet exercised against a real Cloudbeds account from this repo. Now auth-gated (see below) — requires a valid admin `x-villa-token`, not just network reachability.
- **Room-mapping storage**: unchanged — `POST/GET/DELETE /admin/cloudbeds/mapping` still goes through the external `villa-api` Edge Function (not this repo); the live picker only changes where the Room ID/Name values in that form come from.
- **Dead duplicate removed 2026-08-27**: `villa-api` had its own second, never-configured Cloudbeds webhook (`POST /webhook/cloudbeds`) — deleted in `villa-api` v19 (owner-approved) to stop it being a recurring source of confusion. See ARCHITECTURE.md.
- **`/api/admin/cloudbeds/rooms` hardened 2026-08-27**: now requires the caller's `x-villa-token` to pass an admin check against `villa-api`'s own `GET /admin/overview` before calling Cloudbeds — previously any request reaching the Vercel deployment could trigger a Cloudbeds API call. See `src/app/api/admin/cloudbeds/rooms/route.ts`.
- **Dependencies**: `@supabase/supabase-js`, Node `crypto`, native `fetch` (no new npm package added for the Cloudbeds API client).

## Vercel
- **Purpose**: Hosting/deployment platform for the Next.js app.
- **Location in code**: `vercel.json` (`{"framework": "nextjs"}`); commit `d203c7f` "chore: trigger redeploy after fixing Vercel project framework setting" confirms an actual Vercel project exists and has been operated on.
- **Data IN/OUT**: N/A (hosting, not a data integration).
- **Authentication method**: N/A from repo (Vercel project/GitHub App linkage is external to this repo).
- **Status**: ACTIVE (see DEPLOYMENT.md).
- **Dependencies**: none in-repo beyond standard Next.js build.

## WhatsApp sending — CONFIRMED 2026-08-27 via direct `villa-api` source read (Supabase MCP): it is a bridge to Mkhsistem, not "WhaCenter"
- **Purpose**: sending WhatsApp notifications (check-in PIN codes, cleaning-service dispatch, ad hoc staff messages) to guests and staff.
- **Location in code**: **NONE in this repo** (confirmed, not just unaudited) — `src/app/admin/wa-log/page.tsx` is only a read-only viewer of `GET /admin/wa/log`. The actual send logic lives entirely inside `villa-api`'s `sendWa()` function.
- **Mechanism (read from live `villa-api` v18 source)**: `sendWa()` reads `integration_settings` row `key='vercel_bridge'` (`{base_url, secret}`) and does `POST ${base_url}/api/wa/send` with header `x-internal-secret: <secret>` and body `{phone, message, ...meta}`. Queried directly (2026-08-27): **`vercel_bridge.base_url = https://mkh.haluoleo.id`** — i.e. **this is the sibling "Mkhsistem" (MK Connect) system's own `/api/wa/send` route, not a third-party "WhaCenter" API.** The `secret` value itself was not read (kept out of this file). Every attempt is logged to `wa_messages_log` with status `sent`/`failed`/`error`/`skipped_no_phone`/`skipped_not_configured`.
- **Historical "WhaCenter" commit messages** (`71552b2`, `01bcad3`, `32d6ff5`) refer to an earlier design; the currently deployed `villa-api` v18 no longer calls any such service directly — it calls Mkhsistem instead. Treat "WhaCenter" as superseded terminology, not the live mechanism.
- **Status**: ACTIVE (`vercel_bridge` setting is populated), contingent on Mkhsistem's `/api/wa/send` being reachable and correctly secreted — not independently verified from this repo.

### OTA booking alert WA (added 2026-08-28) — housekeeping + reception, via villa's own webhook route (not villa-api)
When a Cloudbeds/OTA reservation event matches a mapped unit, `src/app/api/webhooks/cloudbeds/route.ts` now also sends a WA alert (in addition to the existing in-app `notifications` row and the new `housekeeping` amenities task — see FEATURES.md/DATABASE.md). Implemented as a local `sendWaBridge()` in that route, duplicating villa-api's `sendWa()` contract exactly (same `vercel_bridge` setting, same `/api/wa/send` call, same `wa_messages_log` logging) — necessary duplication since this route runs on Vercel/Node and villa-api is a separate Deno Edge Function; they can't share source.
- **Housekeeping recipients**: looked up from **Mkhsistem's own `employees` table** (same shared Supabase project) — `employees` joined to `divisions` where `divisions.name ILIKE 'Housekeeping Villa'` and `employment_status = 'active'` and `deleted_at IS NULL`. Owner's explicit choice: keep employee records in one place (Mkhsistem HR) rather than duplicating a phone number into villa's own `villa_staff` table. **Requires manual setup in Mkhsistem** (not done by this repo, not done by this session): create a Division named exactly `Housekeeping Villa` (checked live — no such division exists yet as of 2026-08-28; `positions` in Mkhsistem are generic org levels like Direktur/Manager/Staff, not job functions, so `divisions` — free-text, admin-editable — was the right table to key on) and assign the housekeeping employee(s) to it. Until that's done, the query returns zero rows and no housekeeping WA is sent (silently — no error, matches the "skip gracefully when not configured" pattern used elsewhere in this codebase).
- **Reception recipients**: looked up from villa's own `villa_users` (`role = 'receptionist'`, `is_active = true`) — no cross-system dependency, phone already lives in this project.

## AI (Gemini) — same borrowing pattern as WhatsApp, confirmed for the (unmerged) CCTV module
- Per AI_AND_AGENTS.md, the unmerged CCTV branch calls `https://mkh.haluoleo.id/api/villa/ai/cctv-vision` rather than Gemini directly — same sibling system, same pattern as the WA bridge above. Villa does not hold its own `GEMINI_API_KEY` in either case.
- The currently deployed `villa-api` v18 (confirmed via source read, 2026-08-27) has no AI/Gemini code at all — consistent with AI_AND_AGENTS.md.

## Relationship to "Mkhsistem" — CONFIRMED 2026-08-27
Villa's own repo/backend implement neither AI nor WhatsApp sending themselves. Both are borrowed from the sibling Mkhsistem (MK Connect) system at `https://mkh.haluoleo.id`: WA via `villa-api`'s `vercel_bridge` setting (confirmed live), AI/Gemini via the CCTV branch's `MKHSISTEM_AI_BRIDGE_URL` (not yet deployed). This resolves the "relationship between this repo and mkhsistem" question PROJECT_CONTEXT.md previously marked UNKNOWN.

## iPaymu (QRIS payment gateway, added 2026-08-27)
- **Purpose**: generates a real dynamic QRIS per Payment Gateway transaction (previously the PG page only displayed a static photo an admin uploaded — no actual QRIS logic existed) and confirms payment status server-to-server.
- **Location in code**: `src/lib/ipaymuApi.ts` (outbound client: `createQrisPayment`, `checkTransactionStatus`); `src/app/api/payment-gateway/qris/route.ts` (staff-gated, generates QR image); `src/app/api/payment-gateway/qris/status/route.ts` (staff-gated, live status check); `src/app/api/webhooks/ipaymu/route.ts` (inbound notify callback); `src/app/front-desk/payment-gateway/page.tsx` (UI wiring — dynamic QR replaces the static image whenever it can be generated, static image stays as fallback).
- **Auth (outbound, VERIFIED against iPaymu's own official `ipaymu-php-api` GitHub source, 2026-08-27)**: `POST /payment/direct` and `POST /transaction` at `https://{my,sandbox}.ipaymu.com/api/v2`, headers `va` + `signature` + `timestamp`, `signature = HMAC-SHA256(apiKey, "POST:"+va+":"+sha256hex(JSON.stringify(body))+":"+apiKey)`.
- **NOT verified** (docs.ipaymu.com and iPaymu's official signature PDF were unreachable — network egress to that domain is blocked in this dev environment): the exact JSON response shape of `/payment/direct`, and the v2 webhook (`notifyUrl`) payload/signature scheme. `parsePaymentResponse` in `ipaymuApi.ts` is deliberately defensive (tries several plausible field names) rather than assuming an unconfirmed shape — **must be tested against a live iPaymu sandbox call before trusting in production**, per the code comments and DEPLOYMENT.md.
- **Webhook trust model (deliberate, see route comments)**: `/api/webhooks/ipaymu` does NOT trust the inbound callback payload or any signature on it (can't verify iPaymu v2's callback signature scheme yet). It only uses the callback as a trigger to call `checkTransactionStatus` ourselves, authenticated with our own signature — only that self-initiated, authenticated response can mark a `walkin_payments` row `lunas`. This makes the unverified inbound signature a non-issue: an attacker POSTing a fake "paid" callback gets nothing, because we independently ask iPaymu and iPaymu itself decides.
- **Scope, deliberately narrow**: only `walkin_payments` (cafe/spa/lainnya, `referenceId` prefix `walkin_`) are auto-marked `lunas` by the webhook. Villa bookings (`referenceId` prefix `villa_`) are NOT auto-checked-in from the webhook — check-in has side effects (WA PIN send via the Mkhsistem bridge, transaction recording for the 70/30 investor split, unit status change) that stay a deliberate staff action via the existing "Tandai Lunas & Check-In" button. That button's modal now also shows a live "Cek Status" (iPaymu-confirmed paid/not-paid) so staff aren't guessing, without automating the check-in itself. This was an explicit owner decision (2026-08-27), not inferred.
- **Status**: code in place, builds clean, but **inert until `IPAYMU_VA`/`IPAYMU_API_KEY` are set in Vercel** (falls back to the pre-existing static QRIS image otherwise) — not yet exercised against a real iPaymu sandbox/production account. See DEPLOYMENT.md for the activation checklist.
- **Dependencies**: `qrcode` (new, for rendering a raw QRIS payload string into a scannable image when iPaymu returns text rather than a ready image URL — response shape unconfirmed, see above), Node `crypto`, native `fetch`.

## Meta / Ads Manager / OTA (other than Cloudbeds) / Google / storage / email
No code, env var, or `integration_settings` key evidence for any of these was found. NOT IMPLEMENTED, confirmed against the live `villa-api` v18 source (not just this repo) as of 2026-08-27.
