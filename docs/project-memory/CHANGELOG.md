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
