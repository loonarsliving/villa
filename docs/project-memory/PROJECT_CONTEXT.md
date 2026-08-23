# PROJECT_CONTEXT.md

## Project name
"Loonars Villa" (package.json name: `loonars-villa`). In-app branding: **"Loonars Private Living"**. A footer credit reads **"PT. Maha Karya Haluoleo"** (`src/app/login/page.tsx`).

## Purpose
A Next.js web front-end for managing a villa/property rental operation: unit availability, guest bookings/check-in-out, housekeeping tasks, investor (unit owner) financial reporting, and staff/user administration. Booking source can be direct/manual or synced from **Cloudbeds** (a channel manager / OTA distribution platform).

Evidence: route tree under `src/app/{admin,front-desk,investor}` (see ARCHITECTURE.md), domain types in `src/lib/types.ts` (Unit, Booking, Transaction, Notification, HousekeepingTask, Report, CloudbedsMapping, etc.).

## Users / roles
Source of truth: `src/lib/types.ts` — `export type Role = "owner" | "receptionist" | "admin";` and `src/lib/auth.tsx` `roleHome()`:
- `receptionist` → `/front-desk` (front desk / operational staff: booking list, housekeeping, siteplan, notifications)
- `admin` → `/admin` (labelled "Business Owner"/"Admin" in the UI — overview, investors, users, staff, Cloudbeds integration, WhatsApp log)
- everything else (i.e. `owner`) → `/investor` (unit investor/owner: laporan/report, opex, pendapatan/income, notifications)

Note: the UI copy at login says "Portal Investor, Manajemen & Resepsionis" (Investor, Management & Receptionist), consistent with the three roles above.

### Role capability map (confirmed against code + owner instruction, 2026-08-23)
- **`receptionist`** — Front Desk operations only: check-in/checkout (with double-booking-safe unit picking), view OTA (Cloudbeds) + all bookings, housekeeping, siteplan, notifications, and the Payment Gateway walk-in cashier (`/front-desk/payment-gateway` — one shared feature with admin, not a duplicate).
- **`admin`** (labelled "Business Owner" in UI) — sees everything implemented in this repo: overview, all revenue/reports, investor management, user/staff management, Cloudbeds integration, WhatsApp log, and Payment Gateway. Access to both is by role alone now — the earlier email-whitelist extra gate on Payment Gateway was removed 2026-08-23 per owner instruction, since role gating (`admin`/`receptionist`) was judged sufficient on its own. **Gap:** the owner also wants CCTV visibility for this role — **NOT implemented on `main`**; only exists on the unmerged, not-yet-audited `claude/frigate-ai-cctv-module-eqwuri` branch (see FEATURES.md/AI_AND_AGENTS.md). Treat "admin sees CCTV" as PLANNED, not DONE, until that branch is reviewed and merged.
- **`owner`** (labelled "Investor" in UI) — per explicit 2026-08-23 instruction, sees **collective/villa-wide** data, not per-unit: overall income (rental + cafe/spa breakdown), the bagi-hasil pool, and their own equal share (`per_investor_amount`). A unit (e.g. "Unit A2") is only a stay-rights token (12 nights/year outside high season) — it is NOT the basis for revenue-share proportion. See DATABASE.md / FEATURES.md for the `villa-api` v17/v18 changes that implement this (removed `unit_id` scoping on `/report`, `/transactions`, `/notifications` for this role; added `investor_count` and `per_investor_amount` to `computeReport()`).

## Main functions (as evidenced by pages/components)
- Front desk: unit status board (siteplan), booking list, housekeeping task checklist, real-time notifications, double-booking-by-date prevention (commit `346ab86`).
- Admin: business overview KPIs, investor management, user management (create/deactivate/reset password), operational staff management, Cloudbeds room-mapping and event log, WhatsApp send log.
- Investor: monthly report (`Report` type: gross revenue, opex, marketing %, net, owner/loonars/pengelola split, jaminan/deposit), transactions, notifications, first-login password change + profile completion flow.
- Cloudbeds webhook (`src/app/api/webhooks/cloudbeds/route.ts`) ingests reservation events, matches to a mapped unit, creates/updates a booking + guest + notification, and logs the event — purely for OTA availability/booking sync; check-in/out remains a manual Front Desk action (there is explicitly no smart-lock integration — see code comment).

## Relation to other systems
- The frontend calls a **Supabase Edge Function** named `villa-api` at a hardcoded URL (`https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api`, see `src/lib/api.ts`) for essentially all business logic (login, CRUD for bookings/units/reports/users/etc). **The source code of that Edge Function is NOT present in this repository.** UNKNOWN — NEEDS CONFIRMATION: where `villa-api` source lives, how it is deployed/versioned, and its exact endpoint contract beyond what call sites in this repo imply.
- Code comments reference a sibling project **"mkhsistem"** as the pattern this repo's Cloudbeds-webhook credential handling mirrors, and an unmerged branch (`claude/frigate-ai-cctv-module-eqwuri`) references routing AI vision detection "through Mkhsistem's Gemini instead of its own" — implying a related system named "Mkhsistem"/"mkh-properti" exists but is a separate codebase. UNKNOWN — NEEDS CONFIRMATION: relationship/ownership between this repo and "mkhsistem".
- Cloudbeds (external SaaS channel manager) and WhaCenter (external WhatsApp sending service, per git history) are external integrations — see INTEGRATIONS.md.

## Status
Actively developed. `main` branch (current HEAD `ab473b3`, "chore: ignore tsbuildinfo artifact") represents a working Next.js 15 app deployed via Vercel (`vercel.json` present, `framework: nextjs`). Several feature/security branches exist unmerged into `main` (Next.js 16 upgrade, hardened auth proxy, AI CCTV module) — see GIT_WORKFLOW.md / CURRENT_STATE.md.

## Key principles observed in code/comments
- Secrets belong only in Vercel environment variables, never in the database or repo (explicit comment in the Cloudbeds webhook route).
- Cloudbeds is "purely a channel manager" — no automatic smart-lock / physical access integration exists or is intended per current code comments.
- Indonesian-language UI and field names throughout (`nama`, `tgl_checkin`, `pesan`, etc.) — this is an Indonesian-market product.
