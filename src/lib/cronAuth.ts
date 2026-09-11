import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Cron auth for the pricing jobs, accepting EITHER:
 *  - CRON_SECRET (the Vercel env var Vercel itself sends when it invokes
 *    a scheduled path), or
 *  - integration_settings.cron.secret (the DB-stored secret villa-api
 *    already uses to guard its own cron endpoints -- same pattern, not a
 *    new mechanism).
 *
 * The second path exists so a run can be triggered on demand for
 * verification without a human clicking a button in the admin UI (owner
 * request 2026-09-11). It does not widen real exposure: reading that
 * secret requires service-role access to the database, which is already
 * far more powerful than triggering a rate sync. Deliberately applied to
 * the two pricing crons only, not to every cron route.
 */
export async function isAuthorizedCronRequest(request: Request): Promise<boolean> {
  const auth = (request.headers.get("authorization") || "").trim();
  if (!auth.startsWith("Bearer ")) return false;
  const presented = auth.slice("Bearer ".length);
  if (!presented) return false;

  const envSecret = (process.env.CRON_SECRET || "").trim();
  if (envSecret && presented === envSecret) return true;

  const { data } = await supabaseAdmin().from("integration_settings").select("value").eq("key", "cron").maybeSingle();
  const dbSecret = ((data?.value as { secret?: string } | undefined)?.secret ?? "").trim();
  return !!dbSecret && presented === dbSecret;
}
