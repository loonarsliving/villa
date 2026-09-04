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
