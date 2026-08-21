# ENVIRONMENT.md

All env var names found by grepping `process.env.` and `import.meta.env.` across `src/` on `main` (branch `claude/project-memory-audit-af4m1t`, based on `main`@`ab473b3`). No values are recorded — names only.

## Variables used on `main`

| Name | Purpose | Required/Optional | Scope | Where used |
|---|---|---|---|---|
| `CLOUDBEDS_WEBHOOK_SECRET` | Shared secret to authenticate inbound Cloudbeds webhook requests (compared via timing-safe equality against the `x-cloudbeds-secret` request header). Route returns HTTP 503 if unset. | Required (for the webhook to function; app still builds/runs without it, but the endpoint refuses all requests) | Production (server-side only, Vercel env var per code comment) | `src/app/api/webhooks/cloudbeds/route.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key, used to write directly to Postgres (bypassing RLS) from the Cloudbeds webhook route. Route returns HTTP 503 if unset. | Required (for the webhook to function) | Production (server-side only, Vercel env var per code comment) | `src/app/api/webhooks/cloudbeds/route.ts` |

No `NEXT_PUBLIC_*` (client-exposed) environment variables are used anywhere. The Supabase project URL (`https://svcmybsziaelwwdrnzcv.supabase.co`) and the `villa-api` Edge Function base path are **hardcoded string literals** in `src/lib/api.ts`, not environment-driven — so there is currently no way to point this frontend at a different Supabase/API environment (e.g. staging) via env vars alone.

## No `.env.example` in this repo
`.gitignore` excludes `.env`, `.env.local`, `.env.*.local`, `.env.production` — confirming env files are expected locally/in Vercel but none is checked in, and there is no `.env.example` template documenting expected variables for a new developer. This means the table above (derived purely from `process.env.*` grep) is the only in-repo record of required variables.

## Variables referenced only on unmerged branches (NOT active on `main` — listed for awareness only)
These appear in code on branches not merged into `main`; do not assume they are configured in production unless that branch is confirmed merged and deployed:
- `MKHSISTEM_AI_BRIDGE_URL` — optional override for the AI bridge endpoint URL, default `https://mkh.haluoleo.id/api/villa/ai/cctv-vision`. Branch `claude/frigate-ai-cctv-module-eqwuri`, `src/lib/aiBridge.ts`.
- `VILLA_BRIDGE_SECRET` — shared secret authenticating this app to the external Mkhsistem AI bridge. Same branch/file.
- `GEMINI_API_KEY` — used by an earlier, since-replaced version of the same branch (commit `db248d5`, superseded by `b2fa553` which removed it in favor of the bridge above). Not present in the branch's current state.

## UNKNOWN — NEEDS CONFIRMATION
- Any environment variables consumed inside the external `villa-api` Supabase Edge Function (its source is not in this repo, so its env var needs are invisible here) — e.g. it almost certainly needs its own Supabase service-role key and possibly a WhatsApp/WhaCenter API key, but none of that can be confirmed from this repository.
- Whether a `NEXT_PUBLIC_API_BASE` or similar variable was ever used before the URL was hardcoded, or is planned.
