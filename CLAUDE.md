# CLAUDE PROJECT MEMORY

Before doing any coding work:

1. Read this file.
2. Read /docs/project-memory/PROJECT_CONTEXT.md
3. Read /docs/project-memory/CURRENT_STATE.md
4. Read /docs/project-memory/DEVELOPMENT_WORKFLOW.md
5. Read /docs/project-memory/GIT_WORKFLOW.md
6. Read /docs/project-memory/DEPLOYMENT.md
7. Read relevant documentation before modifying a feature.

IMPORTANT:

DO NOT TRUST CHAT MEMORY.
TRUST THE REPOSITORY MEMORY.

The repository is the persistent memory of this project.

Before modifying existing functionality:

- inspect existing implementation
- understand dependencies
- understand database impact
- understand production impact
- reuse existing patterns

Never:

- delete working functionality without explicit approval
- change architecture without approval
- change database schema without approval
- change production configuration without approval
- expose secrets
- commit secrets
- invent APIs
- invent features
- assume deployment destination

## PRODUCTION SAFETY

Before pushing or deploying, ALWAYS determine:
- current branch
- target branch
- whether target is production
- what will be deployed
- whether database changes are included
- whether environment variables are affected

NEVER push directly to production if the existing workflow indicates another process.
NEVER run destructive production commands without explicit approval.

## MEMORY UPDATE RULE

When a significant feature or architectural change is completed, update the relevant project-memory files. At minimum consider: CURRENT_STATE.md, CHANGELOG.md, ROADMAP.md, ARCHITECTURE.md. Do not update memory with guesses.

## PROJECT-SPECIFIC NOTES (from initial audit, 2026-08-21)

- This repository contains **only the Next.js frontend and one Vercel webhook route**. The application's core backend — a Supabase Edge Function called `villa-api` that handles login, auth, and virtually all CRUD — is **not in this repository**. Do not assume you can see or change backend logic, database schema, or RLS policies from here; they are out of view. See /docs/project-memory/ARCHITECTURE.md and DATABASE.md.
- There are no automated tests and no CI/CD pipeline in this repo. Manual verification (local build + manual role-based check) is the only available gate — see DEPLOYMENT.md's checklist.
- Several feature/security branches exist unmerged into `main` (Next.js 16 upgrade, auth hardening, an AI CCTV module using Gemini via a sibling "Mkhsistem" system). Do not assume any of that is live on `main` — verify against `main` directly. See /docs/project-memory/CURRENT_STATE.md and ROADMAP.md.
- No secrets, service-role keys, or tokens should ever be written into this repository, any `docs/project-memory/*.md` file, or commit messages.
