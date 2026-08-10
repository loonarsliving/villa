import "server-only";

import { supabaseAdmin } from "./supabaseAdmin";

/**
 * Villa's session token (villa_token) is issued and verified by the external
 * villa-api Supabase Edge Function -- its signing secret isn't available to
 * this module. So instead of decoding a JWT, every CCTV route re-checks the
 * caller-supplied user id against villa_users directly: it must exist, be
 * active, hold the admin role, AND match CCTV_ALLOWED_USER_ID exactly (set
 * to Avianto Perdana's id). This mirrors the same trust level the rest of
 * the app already places in the client (role checks read from localStorage),
 * just re-verified server-side against the database instead of blindly
 * trusted from a header.
 */
/** Avianto Perdana's villa_users.id -- overridable via env if the account is ever recreated. */
const DEFAULT_ALLOWED_USER_ID = "1a76484c-7041-4274-9519-730f918525ed";

export async function requireCctvUser(request: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const allowedId = (process.env.CCTV_ALLOWED_USER_ID || DEFAULT_ALLOWED_USER_ID).trim();

  const userId = (request.headers.get("x-villa-user-id") || "").trim();
  if (!userId) {
    return { ok: false, status: 401, error: "missing x-villa-user-id" };
  }
  if (userId !== allowedId) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  const { data, error } = await supabaseAdmin()
    .from("villa_users")
    .select("id, role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data || !data.is_active || data.role !== "admin") {
    return { ok: false, status: 403, error: "forbidden" };
  }

  return { ok: true };
}
