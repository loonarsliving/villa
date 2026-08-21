# DEVELOPMENT_WORKFLOW.md

Reconstructed from git history and repo state only — nothing here is invented.

## How development has actually happened
- The project began as a static HTML dashboard (per commit `bc74d1b` "Migrate villa frontend from static HTML to Next.js" and `8b2524a` "Merge origin/main (concurrent HTML dashboard work) into Next.js migration", and the very first commit `18977d1` "Add files via upload" on 2026-06-13).
- It was migrated to Next.js (App Router) on 2026-08-09, with a same-day merge reconciling concurrent HTML-based work that had continued in parallel (`6e47839` "Port must-change-password flow, Cloudbeds mapping UI, and other improvements found in a concurrent HTML-based commit on this repo").
- Most subsequent work is organized into topic-scoped `claude/*` branches (see GIT_WORKFLOW.md), each addressing one feature, redesign, or security topic — consistent with an AI-agent-driven (Claude Code) development pattern rather than long-lived manual feature branches.
- A UI redesign ("light, colorful mobile-style theme") landed via a merge commit on 2026-08-18 (`54fc066`/`932f6de`), the same day as the current `main` tip.
- No evidence of a formal Sprint/iteration cadence (no sprint labels, milestone files, or `docs/sprints/` directory) — work appears topic/task-driven, one branch per requested change.

## How dev starts (local)
Inferred from `package.json` scripts — no separate onboarding doc exists:
```
npm install
npm run dev     # next dev
```
No `.env.example` file exists in this repo, so the exact environment variables a fresh local instance needs are not documented in-repo beyond what's grep-able from source (see ENVIRONMENT.md). UNKNOWN — NEEDS CONFIRMATION: is there a local Supabase stack expected, or does local dev always point at the shared hosted Supabase project (`svcmybsziaelwwdrnzcv`)? The hardcoded URL in `src/lib/api.ts` strongly suggests the latter — there is no env-var override for the API base URL.

## How features are built
Pattern observed across commits: a new/changed page under `src/app/<role>/...`, using the shared `api` client (`src/lib/api.ts`) against `villa-api`, shared UI primitives (`Card`, `Modal`, `StatCard`, `DashboardShell`), and shared `types.ts` additions for new domain shapes. No test files accompany any commit.

## How DB changes / migrations are made
**Cannot be reconstructed from this repo** — there is no `supabase/migrations` directory and no SQL files anywhere in git history for `main`. Schema changes must happen directly against the hosted Supabase project (via dashboard, CLI outside this repo, or inside the separate `villa-api` codebase) and are invisible to this repository's history. UNKNOWN — NEEDS CONFIRMATION on where/how migrations are actually authored and applied.

## How testing is done
**No automated testing exists.** No test runner, no test files, no `npm test` script. Verification is presumably manual (review a Vercel preview deploy, or check production after deploy). No evidence of dedicated staging/preview verification steps was found in-repo beyond what Vercel provides automatically for a git-connected project.

## How builds are done
`npm run build` (`next build`), per `package.json`. `next.config.mjs` only sets `reactStrictMode: true` — no custom webpack/build config, no output mode override (e.g. no `output: "export"` or `"standalone"`), consistent with a standard Vercel-hosted Next.js app.

## How bugs are fixed
Observed pattern: dedicated commits/branches with descriptive fix messages, e.g. `17ebbd8` "security: fix hardcoded admin token + add .gitignore", `346ab86` "Cegah double-booking berbasis tanggal di Front Desk" (prevent double-booking), and on unmerged branches, `a6c853b` "Validate Cloudbeds webhook reservation payload before writing to Supabase" and `1657dfb` "Harden client-side role gating with server-side proxy...". Security-flavored fixes are common in this project's history.

## Commit conventions / branch usage / deployment
See GIT_WORKFLOW.md and DEPLOYMENT.md respectively — not duplicated here.

## Sprint-like pattern
None found. No sprint/milestone documentation exists in the repository.
