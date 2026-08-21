# GIT_WORKFLOW.md

## Branches (as of this audit)
- **Default / production branch**: `main` (confirmed via `git remote show origin` → "HEAD branch: main"). Current tip: `ab473b3` "chore: ignore tsbuildinfo artifact" (2026-08-18).
- **No separate "development" branch exists** — work appears to land on feature branches that either merge into `main` directly or remain open.
- **Feature/task branches**, all prefixed `claude/` and pushed to `origin`, one per topic:
  - `claude/file-hub-repo-integration-7nm114`
  - `claude/frigate-ai-cctv-module-eqwuri` (AI CCTV / Gemini work, unmerged)
  - `claude/project-memory-audit-af4m1t` (this audit's branch)
  - `claude/repo-overview-m1rcy2`
  - `claude/security-3-repos-tj69ek` (Next.js 16 upgrade, hardened auth, unmerged)
  - `claude/security-audit-repos-4cs6h7`
  - `claude/tampilan-design-request-c8hju4`
  - `claude/villa-system-no-receptionist-cjofxy`
  
  All of these are visibly **Claude Code session branches** (naming pattern `claude/<slug>-<6-char-id>`), consistent with this repo being developed largely through Claude Code sessions rather than manual local development. None of them are merged into `main` as of this audit (only `main`'s own commits are ancestors of `main`).

## Branch naming convention
`claude/<short-topic-slug>-<random-6-char-suffix>` for Claude-driven work (e.g. `claude/project-memory-audit-af4m1t`). No other convention (e.g. `feature/`, `fix/`) was observed in the branch list.

## Commit conventions
- No enforced convention (no commitlint config, no CONTRIBUTING.md). Observed style is a mix of:
  - Free-form imperative English (`"Move Cloudbeds webhook to Vercel, remove DB-backed integration settings"`, `"chore: ignore tsbuildinfo artifact"`)
  - Free-form imperative Indonesian (`"Rombak sistem: dashboard Investor/Manajemen/Resepsionis + integrasi Cloudbeds & WA"`, `"Cegah double-booking berbasis tanggal di Front Desk"`)
  - Occasional `type:` prefixes used informally (`security:`, `chore:`) — not a strict Conventional Commits setup.
- Claude-authored commits carry a trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_...` — visible convention for AI-assisted commits in this repo, should be preserved for consistency.

## Merge / PR process
- No `.github/PULL_REQUEST_TEMPLATE.md` or PR template exists in-repo.
- Merge commits do exist on `main` (e.g. `54fc066` "Merge: redesign UI to light, colorful mobile-style theme", `8b2524a` "Merge origin/main (concurrent HTML dashboard work) into Next.js migration") — indicating both merge commits and direct pushes to `main` have occurred historically. UNKNOWN — NEEDS CONFIRMATION whether a PR-review process is required before merging to `main`, or whether pushes/merges to `main` happen without review (no branch protection config is visible from a repo checkout).

## When push happens / when production deploy happens
- Given Vercel + GitHub integration is evidenced (`vercel.json`, commit `d203c7f` about "Vercel project framework setting"), the implied flow is: push/merge to `main` → Vercel auto-deploys. See DEPLOYMENT.md for the full inferred pipeline and its unverified parts.

## Rules for Claude sessions (this audit does not change any of this)
- This audit branch (`claude/project-memory-audit-af4m1t`) was created from `main` per the task instructions and should be treated the same as any other `claude/*` branch above: pushed to origin, not merged automatically, no PR opened by this session.
