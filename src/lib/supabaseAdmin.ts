import "server-only";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://svcmybsziaelwwdrnzcv.supabase.co";

/**
 * Service-role Supabase client for villa's own Next.js API routes that need
 * direct DB access instead of going through the external villa-api Edge
 * Function -- currently the AI CCTV checkpoint module (cron writes,
 * src/lib/cctvCheckpoint.ts / cctvMonthlyReport.ts) and the KTP-photo
 * upload route, which already used this same pattern inline.
 */
export function supabaseAdmin() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
