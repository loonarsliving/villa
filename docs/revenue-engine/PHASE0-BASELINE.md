# Phase 0 Baseline — Loonars Private Living Revenue Engine Program

Captured 2026-09-04. This document is the frozen reference point every
later phase's financial-safety check (§29 of the implementation mandate)
compares against. **Nothing in this document reflects a code change** —
it is a record of what was already true in production before this
program started.

---

## 1. Architecture as of baseline

```
OTA (not yet connected — Cloudbeds go-live 15 Sep 2026)
   |
   v
Cloudbeds (SaaS PMS/channel manager)
   |  webhook: reservation.created / reservation.updated ONLY
   v
/api/webhooks/cloudbeds (Vercel Route Handler, this repo)
   |  service-role key, direct Postgres write
   v
Supabase Postgres (project svcmybsziaelwwdrnzcv, shared w/ Mkhsistem)
   ^
   |  x-villa-token (HMAC session), service-role client
villa-api (Supabase Edge Function, v25 — see supabase/functions/villa-api/)
   ^
   |  fetch + x-villa-token
Next.js 15 frontend (this repo, all "use client")
```

Runtime boundary rule (preserved, not to be violated by later phases):
- `villa-api` = auth + operational CRUD + business APIs + DB mutations.
- Next.js/Vercel = Cloudbeds integration + webhooks + external API
  clients + cron/background orchestration.
- A future compute-heavy Revenue Engine belongs in a separate
  service/cron layer, not folded into either of the above as a new
  monolith.

## 2. Frozen financial baseline — DO NOT CHANGE without explicit owner approval

Verified directly from the deployed `villa-api` v25 source
(`supabase/functions/villa-api/index.ts`, `computeReport()`):

```
Gross Revenue
  = SUM(transactions.jumlah) WHERE tipe='income' AND periode_bulan=<periode>
    [AND unit_id=<unit_id> if scoped]

Marketing Amount
  = Gross Revenue x marketing_pct
    marketing_pct = integration_settings['finance'].marketing_pct,
                    default 0.275 (27.5%) if unset

Opex ("opex_per_unit" in the API response — a flat % of gross,
       NOT itemized opex_bulanan)
  = Gross Revenue x opex_pct
    opex_pct = integration_settings['finance'].opex_pct,
               default 0.25 (25%) if unset

Net Revenue ("gross_profit" and "net" — same value under both keys)
  = Gross Revenue - Opex - Marketing Amount

Owner Pool (70%)
  = Net Revenue x 0.70   <- hardcoded literal in computeReport(), not
                             read from integration_settings

Pengelola / Loonars (30%)
  = Net Revenue x 0.30   <- hardcoded literal

Per-Investor Amount
  = Owner Pool / COUNT(villa_users WHERE role='owner' AND is_active=true)

Minimum Guarantee ("jaminan")
  jaminan_aktif = Per-Investor Amount < Rp 5,000,000  <- hardcoded literal
  jaminan_topup = jaminan_aktif ? (5,000,000 - Per-Investor Amount) : 0

Walk-in Income (cafe/spa/lainnya — informational only, NEVER included
above)
  = SUM(walkin_payments.jumlah) WHERE status='lunas'
    AND paid_at IN [periode month], grouped by kategori
```

**`opex_bulanan` is fully CRUD-exposed (`GET/POST /opex`) but is NOT read
by `computeReport()`.** Per explicit owner instruction (2026-09-04): this
stays exactly as-is for the main Revenue Management implementation —
Opex remains `Gross x 25%`. `opex_bulanan` may continue to exist as
operational/informational data but must never silently start affecting
payout calculations. Any future change to this must be a separate,
explicitly owner-approved decision, not something Phase 5+ does
incidentally while building reporting.

**Investor payout is a separate system from the Revenue Management
Engine**, per explicit owner instruction. The formulas above, and the
periode/computation timing already in use (including the dividend-list
cron around the 25th of each month), must not be touched by dynamic
pricing, occupancy forecasting, Cloudbeds rate management, or OTA
optimization work in later phases. Any of the following requires
separate, explicit, dated owner approval before changing:
- the 27.5% marketing rate
- the 25% opex rate
- the 70/30 owner/pengelola split
- the Rp 5,000,000 guarantee
- the monthly `periode_bulan` computation window
- the dividend-list cron schedule/recipients

### Baseline verification snapshot (for §29 regression checks)

At baseline capture, live data volumes were minimal (early/pre-launch
state — confirmed via `list_tables`): `bookings` had 1 row, `transactions`
had 1 row, `villa_users` had 19 rows, `investor_profiles` had 5 rows. No
representative full-month report was captured as a numeric baseline
because there is not yet a full month of real transaction volume to
compare against — **the first real §29 regression check must happen once
a genuine month of transactions exists** (realistically, at or after the
15 Sep 2026 Cloudbeds go-live). Anyone changing `computeReport()` before
then must instead verify formula-for-formula equivalence by reading the
diff, not by comparing before/after totals on near-empty data.

## 3. Environment variables (names only — see `.env.example` for the
   Next.js side; `villa-api`'s own env vars live only in Supabase Edge
   Function secrets, never in this repo)

| Variable | Side | Purpose |
|---|---|---|
| `VILLA_SESSION_SECRET` | villa-api (Supabase secret) | HMAC session-token signing key. Function fails closed (503) if unset. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | villa-api (Supabase secret, auto-provided) | DB access, bypasses RLS. |
| `CLOUDBEDS_WEBHOOK_SECRET` | Next.js/Vercel | Inbound Cloudbeds webhook auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Next.js/Vercel | Cloudbeds webhook route's direct Postgres writes. |
| `CLOUDBEDS_API_KEY`, `CLOUDBEDS_PROPERTY_ID` | Next.js/Vercel | Outbound Cloudbeds `getRooms` only (read-only today). |
| `IPAYMU_VA`, `IPAYMU_API_KEY`, `IPAYMU_ENV` | Next.js/Vercel | QRIS payment gateway (currently inert, unverified live response shape). |
| `EZVIZ_APP_KEY`, `EZVIZ_APP_SECRET` | Next.js/Vercel | CCTV live-view token issuance. |
| `CRON_SECRET` | Next.js/Vercel | Gates the CCTV/dividend Vercel Crons. |

No values are recorded here or anywhere in this repository.

## 4. Production safety checklist (apply before every future phase)

- [ ] Change is additive to schema unless explicitly owner-approved as
      destructive.
- [ ] No table outside the villa-owned list in
      `supabase/migrations/README.md` is touched.
- [ ] No financial constant in section 2 above changes without a dated,
      explicit owner approval recorded in this file's changelog.
- [ ] Migration tested for conflicts against live data before applying
      (see `supabase/migrations/README.md`).
- [ ] `villa-api` changes are deployed only after being committed and
      reviewed in `supabase/functions/villa-api/`, never edited live in
      the Supabase dashboard/MCP without a matching commit.
- [ ] No secret value is ever written into this repo.
- [ ] Lint/typecheck/build pass locally before any deploy.
- [ ] Investor payout numbers for any already-reported period are
      unchanged by the release.

## 5. Changelog

- **2026-09-04** — Phase 0 baseline established. `villa-api` v25 source
  captured and committed. §6.1 read-only double-booking conflict scan run
  against production: **0 conflicts found** (see commit message / session
  record). No code deployed, no schema changed, no secrets touched.
- **2026-09-04** — Phase 1 design + draft code complete (see
  `PHASE1-DESIGN.md`).
- **2026-09-04** — Owner approved applying Phase 1/3/4 to production and
  named the Phase 3 room-type decision (2 categories: Standard, Sawah
  View +Rp100,000/hari). Executed same day:
  - Applied `20260904000001_booking_exclusion_constraint.sql`,
    `20260904000002_atomic_checkin_checkout_rpc.sql`,
    `20260904000003_room_types_channels_rate_plans.sql` (room types
    seeded per owner instruction; unit assignment still pending — see
    `PHASE3-DESIGN.md`), `20260904000004_daily_inventory_snapshot.sql`.
  - Deployed `villa-api` v26 (server-side pricing for new bookings, date
    validation, constant-time auth comparison, live role/active-state
    revalidation, minimum password length for admin-created accounts).
    Re-fetched and diff-verified against the reviewed source — exact
    match. `computeReport()` and every frozen financial constant in §2
    above are untouched.
  - Live functional confirmation found via Supabase's own function
    logs (`query_logs`) since direct `curl` from this session is
    blocked by the environment's egress proxy policy: `POST
    /cron/cleaning-calls` returned real HTTP 200 responses at 08:45
    and 09:00, both after the v26 deploy, and `function_logs` shows
    clean boot/shutdown cycles with no errors. Real evidence, not just
    a structural check. Still recommend one real staff login +
    check-in to specifically exercise the newly-changed booking/
    check-in/checkout paths.
  - Confirmed via Vercel (`list_deployments`) that the Phase 4 cron
    route is not yet live: every commit on this branch has deployed to
    preview only (`target: null`); production (`living.haluoleo.id`)
    still points at the pre-program `main` tip. Recommend merging soon.

- **2026-09-04** — Owner named the 3 Sawah View units directly: A5, B4,
  C4. Applied `20260904000005_assign_sawah_view_units.sql`: those 3 →
  `sawah_view` room type, `tarif_harian` Rp500,000 → Rp600,000 (live
  now — new bookings for these units already use the new rate via
  villa-api v26's server-side pricing). The other 10 units → `standard`,
  unchanged. Verified post-apply via direct query.
  Still pending: the §16 Cloudbeds API capability confirmation
  (unrelated to this round, tracked separately).

- **2026-09-04** — Owner provided a fuller pricing structure before
  merge: base/min/max guardrail per room type (confirmed interpretation
  via `AskUserQuestion` first, since 3 numbers per category was
  ambiguous and this changes real guest pricing). Applied
  `20260904000006_room_type_price_guardrails.sql`: Standard
  min/base/max = Rp600,000/650,000/1,000,000; Sawah View =
  Rp700,000/750,000/1,100,000. `units.tarif_harian` now live at the new
  base rate (was 500k/600k after the previous migration, now 650k/750k)
  — supersedes that earlier flat +100k bump. `min_rate`/`max_rate` are
  new guardrail columns on `villa_room_types`, stored for Phase 6's
  Revenue Engine but not enforced by anything yet. `tarif_bulanan` not
  touched. Verified post-apply via direct query.
