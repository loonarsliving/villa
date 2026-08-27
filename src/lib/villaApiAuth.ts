const VILLA_API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

async function tokenPasses(token: string, path: string): Promise<boolean> {
  const res = await fetch(`${VILLA_API_BASE}${path}`, {
    headers: { "x-villa-token": token },
  });
  return res.ok;
}

/** Confirms an x-villa-token belongs to an admin session, by forwarding it to villa-api's own admin-only /admin/overview. */
export async function isAdminToken(token: string): Promise<boolean> {
  return tokenPasses(token, "/admin/overview");
}

/** Confirms an x-villa-token belongs to an admin OR receptionist session, by forwarding it to villa-api's own staff-only /summary. */
export async function isStaffToken(token: string): Promise<boolean> {
  return tokenPasses(token, "/summary");
}
