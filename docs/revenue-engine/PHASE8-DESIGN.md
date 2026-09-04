# Phase 8 — AI Insight (reasoning/explanation layer)

Status: built this round —
`src/lib/aiBridge.ts` (`explainPricingRecommendation`),
`src/app/api/admin/pricing-insight/route.ts`,
`/admin/pricing-recommendations` ("✨ Tampilkan AI Insight" button),
plus the bridge side in the sibling `loonarsliving/Mkhsistem` repo:
`lib/ai/domains/villa-pricing-insight.ts` and
`app/api/villa/ai/pricing-insight/route.ts`.

## What it is — and, more importantly, what it is NOT

Per the master mandate's explicit, non-negotiable rule: **AI is
reasoning-only, never source-of-truth for pricing.** This phase does not
add a second pricing engine. It adds one thing: an optional, on-demand
button that asks Mkhsistem's existing Gemini-backed AI Service to phrase
a short plain-language explanation of a recommendation the Phase 6
deterministic rule engine already computed.

- The model is given the finished numbers (current/recommended rate,
  delta%, occupancy%, guardrail status, confidence) and asked only to
  explain them in Bahasa Indonesia — never asked to suggest a different
  number, never asked to decide anything.
- Its output is **never persisted** into `villa_pricing_recommendations`
  or `villa_rates`. It's fetched fresh on click and shown only in the
  browser. Approving/rejecting still writes only the rule engine's own
  numbers — see `PATCH /admin/pricing-recommendations` in
  `supabase/functions/villa-api/index.ts`, untouched by this phase.
- It's opt-in per row (a button, not auto-loaded for every
  recommendation) so it costs a real Gemini call only when an admin
  actually wants the extra context.

## Bridge mechanism

Reuses the exact same pattern already proven by the AI CCTV checkpoint
module (`src/lib/aiBridge.ts`'s `detectPersonInZone`): villa has no
Gemini credential of its own, so it calls a dedicated endpoint in
Mkhsistem's app (`/api/villa/ai/pricing-insight`) authenticated with the
same shared secret already used for the WhatsApp bridge and the CCTV
vision bridge (`integration_settings.vercel_bridge` /
`VILLA_BRIDGE_SECRET`) — not a new, separately-managed credential.

On the Mkhsistem side, `lib/ai/domains/villa-pricing-insight.ts` calls
the shared `askAI()` entrypoint (`lib/ai/service.ts`) — the same
resilience/retry/circuit-breaker layer every other AI domain in that
codebase uses, nothing bespoke.

## Explicit non-goals

- No chat interface, no follow-up questions — one explanation per
  recommendation, on demand.
- Never called by the generation cron (`/api/cron/generate-pricing-
  recommendations`) — that stays 100% deterministic with zero model
  calls, so its core guarantee (no AI dependency for generating
  recommendations at all) is unchanged.
- If the AI bridge fails (Mkhsistem down, bridge not configured), the
  recommendation itself is completely unaffected — the button just shows
  an error, approve/reject still works normally.
