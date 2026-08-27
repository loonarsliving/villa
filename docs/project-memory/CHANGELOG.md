# CHANGELOG.md

Built entirely from `git log` on `main` (branch `claude/project-memory-audit-af4m1t`, based on `main`@`ab473b3`). No entries are fabricated; dates are commit dates from git.

## main branch history (oldest → newest)

### 2026-06-13
- `18977d1` — Add files via upload (initial commit / project bootstrap).

### 2026-08-04
- `17ebbd8` — security: fix hardcoded admin token + add `.gitignore`.

### 2026-08-09
- `f2ffcfb` — Rombak sistem: dashboard Investor/Manajemen/Resepsionis + integrasi Cloudbeds & WA (system overhaul: Investor/Management/Receptionist dashboards + Cloudbeds & WhatsApp integration).
- `bc74d1b` — Migrate villa frontend from static HTML to Next.js.
- `6e47839` — Port must-change-password flow, Cloudbeds mapping UI, and other improvements found in a concurrent HTML-based commit on this repo.
- `8b2524a` — Merge origin/main (concurrent HTML dashboard work) into Next.js migration.
- `d203c7f` — chore: trigger redeploy after fixing Vercel project framework setting.
- `2ddcff5` — Move Cloudbeds webhook to Vercel, remove DB-backed integration settings.
- `346ab86` — Cegah double-booking berbasis tanggal di Front Desk (prevent date-based double booking).

### 2026-08-18
- `932f6de` — Redesign UI to a light, colorful mobile-style theme.
- `54fc066` — Merge: redesign UI to light, colorful mobile-style theme.
- `ab473b3` — chore: ignore tsbuildinfo artifact. *(current `main` tip)*

## Unmerged branch history (not part of `main`, listed for reference only)
- `claude/repo-overview-m1rcy2`: `01bcad3` Pindahkan kredensial Cloudbeds & WhaCenter ke Vercel Environment Variables; `71552b2` Tambah panel Super Admin, integrasi Cloudbeds (OTA) & WhaCenter (WA+PIN kamar).
- `claude/villa-system-no-receptionist-cjofxy`: `d77590a` Rombak sistem: hapus resepsionis, tambah dashboard investor & admin; `1f6a371` Rancang ulang: resepsionis tetap ada, Cloudbeds cuma channel manager; `74daad8` Tambah form data investor (nama+HP) setelah ganti password pertama.
- `claude/security-audit-repos-4cs6h7`: `d5dcf97` security: use real per-session token on owner/receptionist dashboards.
- `claude/file-hub-repo-integration-7nm114`: `32d6ff5` Version villa-api in-repo, add /bridge/occupancy, log real WA send results.
- `claude/frigate-ai-cctv-module-eqwuri`: `db248d5` Add AI CCTV module: EZVIZ checkpoint snapshots + Gemini Vision presence detection; `b2fa553` Route AI CCTV vision detection through Mkhsistem's Gemini instead of its own.
- `claude/security-3-repos-tj69ek`: `1657dfb` Harden client-side role gating with server-side proxy + gate data fetch on auth ready; `a6c853b` Validate Cloudbeds webhook reservation payload before writing to Supabase; `341ac2f` Upgrade Next.js 15.1 -> 16.3.1 to fix known postcss/sharp CVEs.

## This audit
- `claude/project-memory-audit-af4m1t` — added `/docs/project-memory/` and `/CLAUDE.md` (this documentation set). Audit-only; no source code, database, or deployment changes made.

### 2026-08-23 — `claude/payment-gateway-admin-module-2t1mq9`
- Added Payment Gateway module (`admin/payment-gateway/page.tsx`) — admin-only walk-in cafe/spa cashier with an extra email-whitelist gate, static-QRIS display, and transaction history.
- Resolved the `villa-api` source-location mystery: confirmed live only as a deployed Supabase Edge Function (not in this repo, not in `mkhsistem`), read/redeployed directly via Supabase MCP.
- Confirmed the shared Supabase project relationship with `mkhsistem` (MK Connect) described in PROJECT_CONTEXT.md/CURRENT_STATE.md as previously unconfirmed.
- Added `walkin_payments` table (migration `add_walkin_payments_table`) and three new `villa-api` endpoints (`GET/POST/PATCH /admin/walkin-payments`, deployed as villa-api v14) — first production DB schema change and first `villa-api` redeploy made from this repo's git history.
- Surfaced (not remediated) a pre-existing, unrelated security advisory: 2 tables in the shared project have RLS fully disabled (`istri_daily_tips`, `contractor_fund_request_pending`).
- Follow-up same day: moved the QRIS image from localStorage into `integration_settings` (key `walkin_qris`, via existing `/admin/settings` endpoints — no schema change needed); added a read-only `walkin_income` breakdown to `GET /report` (villa-api v15) and a matching info card on the investor dashboard, at the owner's request, so investors can see cafe/spa walk-in income even though it stays out of the 70/30 split. Merged to `main` and deployed to production same day.
- Second follow-up same day: added a "Villa" option to the Payment Gateway kasir for walk-in guests who book directly instead of via OTA/Cloudbeds — deliberately wired into the real booking pipeline (`POST /bookings` → `POST /checkin`) rather than the `walkin_payments` table, since villa rental income must feed the 70/30 investor split (unlike cafe/spa). Added `PATCH /bookings` (villa-api v16) to cancel an unpaid walk-in booking. Merged to `main` and deployed to production same day.
- Third follow-up same day, in response to an owner request to confirm and correct the 3-role capability map:
  - Relocated Payment Gateway from `admin/payment-gateway` to `front-desk/payment-gateway` (villa-api v17 renamed its endpoints off `/admin/*` to `/walkin-payments` and `/walkin-qris`) so receptionist gets the same one feature directly, no email gate; the gate still applies for admin.
  - Made investor (`role=owner`) reporting collective/villa-wide instead of per-unit, per explicit instruction that unit ownership is only a stay-rights token, not a revenue-share basis: `/report`, `/transactions`, `/notifications` no longer scope to the investor's own `unit_id` (villa-api v17). Added `investor_count`/`per_investor_amount` to `computeReport()`, and in v18 corrected the Rp 5jt/month minimum-guarantee check to compare against `per_investor_amount` (per investor) instead of the whole pool — a bug that would have been introduced by the collective-view change if left uncaught.
  - Confirmed CCTV visibility for admin is NOT implemented on `main` (only on the unmerged, unaudited `claude/frigate-ai-cctv-module-eqwuri` branch) — owner asked for that branch to be reviewed (not merged) as a separate step. Audit found: branch diverged from `main` before the entire current UI theme and today's other changes (merging as-is would revert 61 files, including deleting Payment Gateway); its CCTV access check is hardcoded to one specific user id ("Avianto Perdana"), not role-based; needs EZVIZ developer credentials + per-camera serial/verification code; AI vision calls out to Mkhsistem's Gemini bridge; its `cctv_cameras`/`cctv_checkpoint_log` tables already exist in the shared DB from an earlier session but are empty.
- Fourth follow-up same day: removed the email-whitelist super-admin gate (`AccessGate`, `src/lib/superAdmin.ts`) from Payment Gateway entirely, per owner instruction that it's unnecessary now that role gating (`admin`/`receptionist` via `FrontDeskLayout`) is properly in place — access is by role alone for both roles.

### 2026-08-27 — `claude/villa-repo-construction-mapping-pi2uat`
- Prepared the repo for a Cloudbeds API key (self-service, property-level `x-api-key` auth per Cloudbeds' own docs) ahead of the owner adding one: new `src/lib/cloudbedsApi.ts` client + `GET /api/admin/cloudbeds/rooms` route calling Cloudbeds' `getRooms` endpoint.
- Upgraded the admin Cloudbeds mapping page (`src/app/admin/cloudbeds/page.tsx`) with a live room picker sourced from that route, falling back to the existing manual Room ID/Name inputs when `CLOUDBEDS_API_KEY` is unset or the call errors.
- Added `.env.example` documenting all four Cloudbeds/Supabase env vars (no values) — closes a previously documented gap.
- No database schema change, no change to the external `villa-api` Edge Function, no change to how mappings are stored.

### 2026-08-27 (same session) — traced `villa-api` source directly via Supabase MCP, at owner's prompt to verify before continuing
- Read the live deployed `villa-api` v18 source (`get_edge_function`) and confirmed several previously "UNKNOWN"/inferred facts: real server-side session auth + role authorization exists in `villa-api` (not just client-side gating); `villa-api` has its own second, currently-unconfigured Cloudbeds webhook (`POST /webhook/cloudbeds`, DB-stored secret, no `integration_settings` row exists for it — dead code path, this repo's own env-var-based webhook is the live one); WhatsApp sending is not "WhaCenter" but a proxy (`sendWa()` → `integration_settings.vercel_bridge`) to the sibling Mkhsistem system's `/api/wa/send` — confirmed `vercel_bridge.base_url = https://mkh.haluoleo.id` by direct query.
- Updated ARCHITECTURE.md, INTEGRATIONS.md, PROJECT_CONTEXT.md, CURRENT_STATE.md to record these as confirmed, not inferred. No code changes in this step — documentation only.

### 2026-08-27 (same session) — owner-approved villa-api cleanup + Cloudbeds room-picker hardening
- Owner explicitly approved removing the dead, never-configured `POST /webhook/cloudbeds` endpoint from `villa-api` (confirmed unconfigured in the prior step). Deployed `villa-api` v19 with that endpoint deleted; nothing else changed. Verified post-deploy via `list_edge_functions`/`get_edge_function` (status ACTIVE, `verify_jwt: false` preserved). `GET /admin/cloudbeds/log` and `GET/POST/DELETE /admin/cloudbeds/mapping` (which read/write the same `cloudbeds_events_log`/`cloudbeds_room_mapping` tables) are untouched.
- Added a standing rule to `CLAUDE.md`: villa-api behavior must be verified via Supabase MCP before being documented, not inferred — to stop the class of documentation errors found this session (wrong claims about server-side auth and WhatsApp sending).
- Hardened `/api/admin/cloudbeds/rooms` (added 2026-08-27 earlier this session): it was reachable by anyone who could hit the Vercel deployment, with no auth check of its own. Now requires a valid admin `x-villa-token`, verified by forwarding it to villa-api's own `GET /admin/overview` (admin-only) rather than re-implementing token verification in this repo. `src/lib/api.ts` now exports `getToken()` so the admin Cloudbeds page can attach the header. This is the last piece needed before the owner adds `CLOUDBEDS_API_KEY` tomorrow — once that env var is set in Vercel, the live room picker should work end-to-end with no further code changes.
