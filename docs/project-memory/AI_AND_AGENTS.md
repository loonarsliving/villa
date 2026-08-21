# AI_AND_AGENTS.md

## On `main` (current production branch)
**NOT IMPLEMENTED.** No AI/LLM/agent code, no `GEMINI_API_KEY` or similar env var reference, and no `@google/genai` (or other AI SDK) dependency exists anywhere in `main`'s `package.json`, `package-lock.json`, or `src/`.

## On unmerged branch `claude/frigate-ai-cctv-module-eqwuri` (NOT on `main` — documented for awareness only, not implemented in the current app)
This branch adds an "AI CCTV" checkpoint module. Two generations exist within the branch's own history:

1. Commit `db248d5` ("Add AI CCTV module: EZVIZ checkpoint snapshots + Gemini Vision presence detection") — added `src/lib/gemini.ts` calling Google's Gemini API directly with its own `GEMINI_API_KEY`, plus `@google/genai` as a dependency.
2. Commit `b2fa553` ("Route AI CCTV vision detection through Mkhsistem's Gemini instead of its own") — **superseded #1**: removed `src/lib/gemini.ts` and the `@google/genai` dependency, replacing direct Gemini calls with a bridge call to an external sibling system.

### As of the branch's latest commit (`b2fa553`):
- **Name**: "AI CCTV checkpoint" / person-presence detection.
- **Purpose**: Periodically snapshot EZVIZ cameras and ask an AI model a narrow factual question — is a person visible in frame — as a raw presence record for manual human review. Code comment explicitly states it does NOT ask the model to judge "professionalism" or "cleanliness."
- **Model**: Gemini (exact model ID not visible from this repo — the actual Gemini call happens inside the external "Mkhsistem" system, not in this codebase).
- **Input**: base64 image snapshot + mimeType + `zona` (zone/area label), captured from an EZVIZ camera via `src/lib/ezviz.ts:captureSnapshot()`.
- **Output**: `{ person_present: boolean, description: string }`.
- **Tools**: none (single vision inference call, not an agentic/tool-using system).
- **Location in code (on this branch)**: `src/lib/aiBridge.ts` (bridge client), `src/lib/cctvCheckpoint.ts` (orchestrates capture → detect → log), `src/lib/ezviz.ts` (EZVIZ snapshot capture), `src/lib/cctvApi.ts`, `src/lib/cctvGuard.ts`, `src/lib/cctvConstants.ts`, `src/lib/supabaseAdmin.ts`.
- **Caller**: per code comment, both a Vercel Cron endpoint (scheduled, all active cameras) and a manual "run now" dashboard button (one camera, on demand) call the same `runCheckpointForCamera()` function.
- **Authentication to the AI**: none held by this repo — it forwards to `https://mkh.haluoleo.id/api/villa/ai/cctv-vision` (an endpoint on the separate "Mkhsistem" system, default overridable via `MKHSISTEM_AI_BRIDGE_URL`), authenticated with a shared internal secret `VILLA_BRIDGE_SECRET` sent as header `x-internal-secret`. The actual Gemini API key lives entirely in the Mkhsistem system, not here.
- **Status**: IN_PROGRESS / PLANNED relative to `main` — **this entire module does not exist in the currently deployed `main` branch.** Do not treat any of this as active production behavior without confirming the branch has been merged and deployed. UNKNOWN — NEEDS CONFIRMATION whether/when this branch will be merged, and whether "Mkhsistem" (`mkh.haluoleo.id`) is a live, reachable system.

## Agents / orchestrators
No multi-step agent, tool-calling loop, or orchestrator framework (LangChain, custom agent runner, etc.) was found anywhere in this repository, on `main` or on the CCTV branch. The "AI CCTV" feature above is a single-shot vision classification call, not an agent.
