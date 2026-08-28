# ROADMAP.md

No formal roadmap document, issue tracker export, or TODO-comment backlog exists in this repository. This file is built exclusively from what unmerged branches and commit messages imply was planned/in-progress work — nothing here is invented.

## COMPLETED (on `main`)
- Migration from static HTML dashboard to Next.js App Router.
- Role-based dashboards for receptionist (Front Desk), admin, and investor (owner).
- Cloudbeds channel-manager webhook integration (moved to Vercel Route Handler).
- Double-booking-by-date prevention on Front Desk.
- Admin panel: user management, staff management, investor listing, Cloudbeds mapping, WhatsApp send log viewer.
- UI redesign to a light, colorful mobile-style theme.
- First-login forced password change + investor profile completion flow.

## IN PROGRESS (unmerged branches exist)
- Next.js 15.1 → 16.3.1 upgrade to close known postcss/sharp CVEs (`claude/security-3-repos-tj69ek`, commit `341ac2f`).
- Cloudbeds webhook payload validation hardening (`claude/security-3-repos-tj69ek`, commit `a6c853b`).
- Server-side proxy to harden client-side role gating (`claude/security-3-repos-tj69ek`, commit `1657dfb`).
- AI CCTV checkpoint module: EZVIZ snapshot capture + Gemini Vision person-presence detection, routed through a sibling "Mkhsistem" system's AI bridge (`claude/frigate-ai-cctv-module-eqwuri`, commits `db248d5`, `b2fa553`).

## NEXT
UNKNOWN — NEEDS CONFIRMATION. No prioritized "next up" list exists in the repository; the branches above represent the closest available signal of near-term intent, and their order of landing is not documented anywhere.

## PLANNED
UNKNOWN — NEEDS CONFIRMATION. A handful of other `claude/*` branches exist (`file-hub-repo-integration`, `repo-overview`, `security-audit-repos`, `tampilan-design-request`, `villa-system-no-receptionist`) whose branch names suggest topics (file hub, another repo-overview/audit, additional security review, a design request, and a "no receptionist" system variant) but whose content was outside this audit's deep-dive scope. Their existence is evidence of exploratory/candidate work, not a confirmed plan.

## PLANNED (explicit, from owner, 2026-08-27)
- **KTP OCR + Filemanager (Ultron) integration** — Tahap 2/3 of the Check-In Card work. Tahap 1 (photo capture + digital signature, stored in villa's own private `guest-documents` Supabase bucket) is DONE. Not yet built: (a) an AI OCR endpoint on Mkhsistem (their existing Gemini client, no such endpoint exists there yet — confirmed by reading Mkhsistem's `app/api` tree 2026-08-27) that reads a KTP photo and returns structured guest data; (b) routing the KTP photo into the separate "Filemanager"/"Ultron" app (`filemanager.haluoleo.id`, repo `loonarsliving/Filemanager`, not in villa's or this audit's repo access) for permanent storage instead of villa's own bucket. Owner's framing: "sebenarnya semua fitur itu sudah ada, nanti kita benahi" (these capabilities basically already exist elsewhere, we'll wire them up later) — but as of 2026-08-27 no such KTP-OCR or villa-facing Filemanager bridge endpoint was found to exist yet on Mkhsistem's side; this needs re-confirming directly with the owner or by reading the Filemanager repo before building, not assumed.

## UNKNOWN
- Whether the `villa-api` Supabase Edge Function (unaudited, not in this repo) has its own separate roadmap/backlog.
- Whether "Mkhsistem" is an actively developed sibling system with its own roadmap that this app's AI/WhatsApp features depend on.
- Whether a native mobile app is planned.
