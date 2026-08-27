# DEPLOYMENT.md

No credentials are recorded anywhere in this file.

## Production URL
**UNKNOWN — NEEDS CONFIRMATION.** No production domain is recorded in this repository (no `NEXT_PUBLIC_SITE_URL`, no domain string in code, no docs). The related "Mkhsistem" system is referenced at `https://mkh.haluoleo.id` in an unmerged branch's code comment, which suggests the `haluoleo.id` domain family may host this app too — but that is an inference, not a confirmed fact for *this* app.

## Hosting
**Vercel.** Evidence: `vercel.json` at repo root (`{"framework": "nextjs"}`), and commit `d203c7f` "chore: trigger redeploy after fixing Vercel project framework setting" — proves an actual Vercel project exists and has been actively configured/operated.

## Vercel project
Name/ID: UNKNOWN — NEEDS CONFIRMATION (not stored in-repo; Vercel project linkage lives in Vercel's own dashboard / the `.vercel/` directory, which is git-ignored per `.gitignore`).

## GitHub repo / production branch / preview branches
- GitHub repo: `loonarsliving/villa`.
- Production branch: `main` (confirmed default branch).
- Preview branches: standard Vercel-for-GitHub behavior would auto-preview every other branch/PR — the numerous `claude/*` branches in this repo are consistent with that pattern, though this cannot be confirmed without Vercel dashboard access. UNKNOWN — NEEDS CONFIRMATION on exact preview-deployment configuration.

## Deployment workflow (inferred)
1. Change is made on a `claude/*` (or other) branch.
2. Branch is pushed to `origin` on GitHub.
3. If/when merged to `main`, Vercel's GitHub integration (implied by `vercel.json` + the "fix Vercel project framework setting" commit) triggers a production build+deploy.
4. No `.github/workflows` CI exists, so there is **no automated lint/typecheck/test gate before merge or before Vercel deploys** — Vercel's own build step (`next build`, which does run TypeScript type-checking by default) is the only automated gate.

## Build command / install command / output
- Install: `npm install` (uses `package-lock.json`, so `npm ci` is the reproducible equivalent).
- Build: `npm run build` → `next build`.
- Start (if run outside Vercel's platform build): `npm start` → `next start`.
- Output: default Next.js build output (no custom `distDir` or `output` mode set in `next.config.mjs`); Vercel's Next.js framework preset handles packaging automatically (`vercel.json` explicitly sets `"framework": "nextjs"`).
- Lint: `npm run lint` → `next lint` (available but not wired into any CI or pre-deploy gate found in-repo).

## Required env var names
See ENVIRONMENT.md for the full list with purposes. Summary of names found by grep: `CLOUDBEDS_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. No public/`NEXT_PUBLIC_*` env vars are used anywhere in the client code (the Supabase project URL and `villa-api` base URL are hardcoded string literals, not env-driven).

## Supabase production
Project URL `https://svcmybsziaelwwdrnzcv.supabase.co` is hardcoded directly into source (not env-configured), so there is effectively one Supabase environment used by this codebase as checked in — no separate "staging Supabase project" mechanism exists in the code. UNKNOWN — NEEDS CONFIRMATION whether a separate staging/dev Supabase project exists outside this repo's visibility.

## Domain / redirect URLs
UNKNOWN — NEEDS CONFIRMATION. Not present in this repository.

### PRODUCTION DEPLOYMENT CHECKLIST
Reconstructed to match the actual (lightweight, CI-less) workflow evidenced by this repo — not an idealized process:
1. Confirm current branch and that `git status` is clean (no stray local changes).
2. Confirm the target branch is `main` (Vercel's production branch) before merging/pushing — pushing directly to `main` deploys to production with no manual approval gate visible in-repo.
3. Run `npm run lint` locally (`next lint`) — not automated anywhere, so it must be run manually.
4. Run `npx tsc --noEmit` (or rely on `next build`'s built-in type-check) since there is no separate `typecheck` script.
5. There are no automated tests to run (none exist in this repo).
6. Run `npm run build` locally to catch build-time errors before pushing, since Vercel's build is the only real gate and a failed Vercel build blocks deployment.
7. Commit with a clear message; push to `main` (or merge a `claude/*`/feature branch into `main`).
8. Wait for the Vercel deployment to complete (monitor via Vercel dashboard/CLI — not observable from this repo alone).
9. Verify production manually: log in as each role (receptionist/admin/owner) and confirm the dashboards load, since there is no automated smoke test.
10. Specifically re-check the Cloudbeds webhook path after any deploy touching `src/app/api/webhooks/cloudbeds/route.ts` or its env vars, since a misconfigured `CLOUDBEDS_WEBHOOK_SECRET`/`SUPABASE_SERVICE_ROLE_KEY` fails silently from Cloudbeds' perspective (returns 401/503, not a crash).
11. Check Vercel function logs for runtime errors post-deploy (no in-repo logging/monitoring integration was found beyond default Vercel logs).

This checklist is a best-effort reconstruction given the absence of any documented deployment process in the repository — treat items 3–6 and 9–11 as recommended manual discipline rather than an enforced pipeline.

### ADDING CLOUDBEDS_API_KEY (prepared 2026-08-27, for when the owner gets the key)
The repo is ready to receive it with no further code changes. Steps for whoever adds it:
1. In Cloudbeds: Account → Apps & Marketplace → API Credentials → Create. **Select only the scopes actually needed (read rooms)** — do not grant reservation-write/booking-creation scopes to a key only meant to power the room picker. Copy the key immediately; Cloudbeds will not show it again.
2. In Vercel: this project's Settings → Environment Variables → add `CLOUDBEDS_API_KEY` (Production, and Preview if you want to test on a preview deploy first). Only set `CLOUDBEDS_PROPERTY_ID` too if the key is scoped to a multi-property/group account — leave blank for a single property.
3. Never paste the key into a commit, a `docs/project-memory/*.md` file, a PR description, or any client-side code — server-side Vercel env var only (see `src/lib/cloudbedsApi.ts`, which is never imported from a `"use client"` file).
4. Redeploy (Vercel redeploys automatically on env var changes for the next deploy, or trigger one manually).
5. Verify as an admin: open `/admin/cloudbeds`, confirm the green "Terhubung ke Cloudbeds API — N room tersedia" banner replaces the amber "belum tersedia" one, and that "+ Petakan Room" shows a live dropdown instead of manual fields.
6. `/api/admin/cloudbeds/rooms` requires a valid admin session token (hardened 2026-08-27) — if you get 401 while testing, confirm you're logged in as `admin` role, not just hitting the URL directly.

### ADDING IPAYMU_VA / IPAYMU_API_KEY (prepared 2026-08-27, QRIS for Payment Gateway)
Unlike the Cloudbeds work, this one has a real unknown to close before trusting it in production: **iPaymu's actual `/payment/direct` response shape was never confirmed** (their docs site was unreachable from the dev environment that built this) — `src/lib/ipaymuApi.ts` parses it defensively but has not been exercised against a live call.
1. Get `IPAYMU_VA` and `IPAYMU_API_KEY` from the iPaymu dashboard (sandbox account is enough to start — no need to wait for production approval).
2. Set `IPAYMU_VA`, `IPAYMU_API_KEY` in Vercel env vars, and leave `IPAYMU_ENV` unset or `sandbox` — do NOT set it to `production` yet.
3. **Test on sandbox first**: as staff, open Payment Gateway, create a cafe/spa/lainnya transaction, and confirm a real scannable QR renders in the modal (not the "QRIS dinamis gagal dibuat" fallback message). If it fails, the response field names in `parsePaymentResponse` (`src/lib/ipaymuApi.ts`) likely need correcting against the real response — the route returns iPaymu's raw response body in its error JSON specifically to make this diagnosable.
4. Use iPaymu's sandbox payment simulator to complete a test payment, and confirm the transaction in Payment Gateway's history flips to "Lunas" on its own within a few seconds (proves the webhook → `checkTransactionStatus` → DB update path works end to end).
5. Only after that, switch `IPAYMU_ENV` to `production` and swap in production credentials.
6. Reminder of the deliberate scope limit: villa bookings paid via QRIS still need a staff click on "Tandai Lunas & Check-In" — only cafe/spa/lainnya auto-flip to Lunas. This is intentional (see INTEGRATIONS.md), not a bug.
