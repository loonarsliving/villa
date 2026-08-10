import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for the CCTV module's own API routes
 * (src/app/api/cctv/*, src/app/api/cron/cctv-checkpoint). Villa has no
 * Next.js backend of its own for anything else -- all other data goes
 * through the external villa-api Supabase Edge Function -- so this client
 * exists only for this module, which is intentionally self-contained.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://svcmybsziaelwwdrnzcv.supabase.co";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
