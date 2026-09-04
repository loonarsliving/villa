# Phase 2 — Cloudbeds Reliability

Status: **webhook hardening implemented directly** in
`src/app/api/webhooks/cloudbeds/route.ts` (this repo's own Vercel route —
unlike `villa-api`, changes here do **not** reach production until this
branch is merged to `main`, per this repo's existing Vercel/GitHub
deployment flow documented in `docs/project-memory/DEPLOYMENT.md`, so
implementing directly on this feature branch carries no production risk
by itself). Reconciliation and any outbound Cloudbeds write capability
remain **blocked** — see "What's blocked" below.

## What changed in the webhook route

1. **Schema validation** (`zod`, new dependency). The inbound payload is
   validated for field *types* before use — a schema mismatch is logged
   to `cloudbeds_events_log` with the exact validation error and the
   route still returns 200 (so Cloudbeds doesn't retry a payload we've
   already determined we can't process), instead of silently coercing
   bad data into `undefined` fields as before.
2. **Idempotency**. Before processing, the route checks
   `cloudbeds_events_log` for an existing row with the same
   `reservation_id` + `event_type` + an exact hash-match on the stored
   `payload`. An identical redelivery (a Cloudbeds retry) is now a true
   no-op — no duplicate guest, booking write, notification, housekeeping
   task, or WhatsApp send. A payload that differs at all (a genuinely new
   update) is still processed normally. No schema change was needed —
   this reuses the `payload` jsonb column that already existed.
3. **Guest deduplication by phone**. Previously every matched event
   inserted a fresh `guests` row, so a `reservation.created` followed by
   a `reservation.updated` for the same booking (a common Cloudbeds
   pattern) created two guest records for one person. Now, if the
   reservation has a phone number, an existing guest with that phone is
   reused. Guests with no phone on file still get a new row each time —
   there's no reliable key to dedupe on without one, so this is a partial
   fix, not a claim of full guest-identity resolution.
4. **Cancellation handling** — **event name UNCONFIRMED**. The route now
   listens for `reservation.cancelled` or `reservation.canceled` (both
   spellings handled defensively) and marks the matching booking `batal`
   if one exists, with no destructive delete. **This has not been
   verified against a real Cloudbeds webhook delivery or Cloudbeds' own
   documentation** — the exact event name Cloudbeds actually sends for a
   cancellation was flagged as an open item in this program's gap audit
   and remains unconfirmed. Before trusting this in production: either
   find Cloudbeds' documented event name, or trigger a real test
   cancellation once the account is connected (go-live is 15 Sep) and
   check what actually arrives in `cloudbeds_events_log`, then correct
   `CANCELLATION_EVENT_TYPES` in the route if needed. Until confirmed,
   an actual Cloudbeds cancellation might arrive under a different event
   name and simply fall through to the existing catch-all logging (still
   safe — it gets logged with `matched: false`, just doesn't update the
   booking status automatically).

Every other line of the route (secret verification, the room-mapping
lookup, the booking upsert shape, the amenities housekeeping task, the
two WhatsApp sends) is unchanged.

## What's blocked

- **Reconciliation** (§15 of the mandate): requires knowing whether this
  property's Cloudbeds API plan includes a reservations-pull endpoint —
  not confirmed (§16 blocker, tracked since the gap audit). Not built,
  per the explicit instruction not to fake a capability that hasn't been
  verified. Revisit once Cloudbeds API access is confirmed.
- **Outbound rate/availability/restriction writes**: same blocker, same
  reasoning — `src/lib/cloudbedsApi.ts` still only supports the existing
  read-only `getRooms()`.

## Testing

- `npm run build` (includes Next.js's TypeScript typecheck) — clean.
- `npm test` — clean, no regressions (this route has no dedicated tests
  yet; Deno/Edge-Function-style route testing for `villa-api` was noted
  as a Phase 1 follow-up in `phase1-draft/CHANGES.md` — the same gap
  exists here and should be closed together, not as two separate
  Next.js/Deno test setups).
- Manual verification still needed before this reaches `main`: a real or
  simulated Cloudbeds webhook delivery for `created`, `updated`, a
  redelivered duplicate (confirm no duplicate side effects), and — once
  the cancellation event name is confirmed — a cancellation.
