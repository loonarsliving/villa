# FEATURES.md

Status tags: DONE (UI + call site implemented and wired, though server behavior in `villa-api` is unverifiable) / PARTIAL / IN_PROGRESS / PLANNED / UNKNOWN. "DONE" here means "implemented in this repo's frontend/webhook code," not "verified working end-to-end," since the actual backend (`villa-api`) source is not in-repo.

## Auth & onboarding
- **Login (email/password)** — DONE. `src/app/login/page.tsx`, `src/lib/api.ts:login()`.
- **Forced password change on first login** — DONE. `login/page.tsx` step `"newpass"`, calls `POST /me/password`; gated by `SessionUser.must_change_password`.
- **Investor profile completion after first login** — DONE. `login/page.tsx` step `"profile"`, calls `POST /me/investor-profile`.
- **Role-based redirect/home routing** — DONE. `src/lib/auth.tsx:roleHome()`.
- **Client-side route/role gating** — DONE (client-only; see ARCHITECTURE.md caveat re: server-side enforcement being unverifiable). `src/lib/auth.tsx:AuthProvider`.

## Front desk (`/front-desk`)
- **Unit status dashboard / today's summary** — DONE. `front-desk/page.tsx` (`Summary`, `Unit`, `UnitAvailability` types; calls unaudited summary/units endpoints).
- **Siteplan (visual unit grid by block/status)** — DONE. `front-desk/siteplan/page.tsx`.
- **Booking list** — DONE. `front-desk/booking/page.tsx`, `GET /bookings`.
- **Double-booking prevention by date** — DONE per commit message. Commit `346ab86` "Cegah double-booking berbasis tanggal di Front Desk". Actual validation logic is presumably server-side in `villa-api` — UNKNOWN — NEEDS CONFIRMATION on exact enforcement, since it's not visible in this repo's code.
- **Housekeeping checklist (mark task done)** — DONE. `front-desk/housekeeping/page.tsx`, `GET /housekeeping`, `PATCH /housekeeping/done`.
- **Real-time-ish notifications (30s poll)** — DONE. `front-desk/notifikasi/page.tsx` + `src/lib/hooks.ts:useNotifPoll`.

## Admin (`/admin`)
- **Business overview KPIs** (revenue, unit counts, user counts, Cloudbeds unmapped count, WA failed count) — DONE. `admin/page.tsx`, `GET /admin/overview`.
- **Investor management** (list onboarded investor profiles) — DONE. `admin/investors/page.tsx`, `GET /admin/investors`.
- **User management** (create, activate/deactivate, reset password) — DONE. `admin/users/page.tsx`, `GET/POST/PATCH /admin/users`.
- **Operational staff management** (security/cleaning/greeter roster) — DONE. `admin/staff/page.tsx`, `GET/POST/PATCH /admin/staff`.
- **Cloudbeds room-mapping management + event log viewer** — DONE. `admin/cloudbeds/page.tsx`, `GET/POST/DELETE /admin/cloudbeds/mapping`, `GET /admin/cloudbeds/log`.
- **WhatsApp send log viewer** — DONE (viewer only; actual sending is not implemented in this repo). `admin/wa-log/page.tsx`, `GET /admin/wa/log`.
- **Payment Gateway — walk-in cashier (Villa, Cafe, Spa)** — DONE, added 2026-08-23, relocated same day. Now lives at `front-desk/payment-gateway/page.tsx` (route `/front-desk/payment-gateway`) — a single shared feature (not duplicated) reachable from both the Admin and Front Desk nav, gated purely by `FrontDeskLayout`'s existing `requireRole={["receptionist","admin"]}` — no extra email-whitelist step (removed same day per owner instruction: role gating alone is sufficient now that both roles are properly wired). The page picks `AdminShell` or `FrontDeskShell` at render time based on `user.role`. Cafe/Spa/Lainnya: backed by `villa-api` endpoints `GET/POST/PATCH /walkin-payments` (renamed off the `/admin/*` prefix in villa-api v17 specifically so receptionist isn't blocked by the blanket admin-only gate) and the `walkin_payments` table (see DATABASE.md) — not folded into investor revenue-sharing reports by design. Villa (for guests who book directly instead of via OTA/Cloudbeds): reuses the real booking pipeline — `POST /bookings` on QRIS creation, `POST /checkin` on "Tandai Lunas" (creates the `transactions` income row that DOES feed the 70/30 investor split, same as the Front Desk check-in flow), `PATCH /bookings` (villa-api v16) to cancel if unpaid. A "Booking Villa Walk-in Terbaru" list on the same page shows these bookings; they also appear in the existing Front Desk → Daftar Booking page. The QRIS image is stored server-side via dedicated `GET/POST /walkin-qris` endpoints (villa-api v17, `integration_settings` key `walkin_qris`) — moved off the admin-only `/admin/settings` endpoint so receptionist can read/replace it without gaining access to other integration secrets.
- **Investor visibility into cafe/spa income** — DONE, added 2026-08-23. `investor/page.tsx` shows a "Pemasukan Cafe & Spa (Walk-in)" card sourced from `GET /report`'s `walkin_income` field — informational only (villa-wide, not part of the 70/30 split), added at the owner's explicit request since that income is expected to eventually be shared with investors too.
- **Collective (pooled) investor revenue share** — DONE, added 2026-08-23, per explicit owner instruction: investors previously saw data scoped to their own unit only; the actual profit-sharing model is collective (one pool from the whole villa's rental income, split evenly across all active investors) — unit ownership is only a stay-rights token (12 nights/year outside high season), not a revenue-share proportion. `villa-api` v17/v18: `/report`, `/transactions`, `/notifications` no longer scope to `session.unit_id` for `role=owner` — they return villa-wide data. `computeReport()` adds `investor_count` (active `role=owner` `villa_users`, currently 13 — matches the 13-unit, 1:1 investor count) and `per_investor_amount` (`owner_amount` pool ÷ `investor_count`); the Rp 5jt/month minimum-guarantee (`jaminan_aktif`/`jaminan_topup`) was corrected in the same change to compare against `per_investor_amount` rather than the whole pool, since the guarantee is per investor. `investor/page.tsx` and `investor/pendapatan/page.tsx` were updated to show "Bagian Anda" (per-investor share) alongside the pool totals.

## Investor (`/investor`)
- **Monthly report** (gross revenue, opex, marketing %, net, owner/loonars/pengelola split, deposit/jaminan) — DONE. `investor/page.tsx`, `investor/laporan/page.tsx`, `GET /report`.
- **Transactions view** — DONE. `investor/pendapatan/page.tsx`, `investor/opex/page.tsx`, `GET /transactions`.
- **Notifications** — DONE. `investor/notifikasi/page.tsx`.

## Integrations-as-features
- **Cloudbeds OTA sync via webhook** — DONE (this repo's side). `src/app/api/webhooks/cloudbeds/route.ts`. Payload validation hardening exists on an unmerged branch (`claude/security-3-repos-tj69ek`, commit `a6c853b`) — not in `main`, so treat as PLANNED/IN_PROGRESS relative to `main`.
- **WhatsApp notifications ("WhaCenter")** — PARTIAL/UNKNOWN on `main`. Referenced by git history (commits `71552b2`, `01bcad3`, `32d6ff5`) and by the `admin/wa-log` viewer, but no WhaCenter client/API code exists anywhere in this repository's current tree — sending logic, if it exists, lives entirely inside the unaudited `villa-api` Edge Function. Cannot confirm it is currently functional.
- **AI CCTV / presence detection via Gemini Vision (EZVIZ snapshots)** — PLANNED / IN_PROGRESS, NOT on `main`. Exists only on unmerged branch `claude/frigate-ai-cctv-module-eqwuri` (commits `db248d5`, `b2fa553`). See AI_AND_AGENTS.md.
- **Next.js 15→16 security upgrade** — IN_PROGRESS, NOT on `main`. Branch `claude/security-3-repos-tj69ek`, commit `341ac2f`.
- **Server-side role-gating hardening proxy** — IN_PROGRESS, NOT on `main`. Same branch, commit `1657dfb`.

## Explicitly not implemented
- **Smart-lock / automated physical access control** — explicitly NOT implemented and not intended, per code comment in the Cloudbeds webhook route: "there's no smart lock to trigger automatically."
- **Automated testing** — NOT IMPLEMENTED. No test files, test runner config, or test script found anywhere in the repo (`package.json` has no `test` script; no `*.test.*`/`*.spec.*` files; no Jest/Vitest/Playwright config).
- **CI/CD pipeline** — NOT IMPLEMENTED. No `.github/workflows` directory exists.
