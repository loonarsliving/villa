import "server-only";

/**
 * EZVIZ Open Platform client (https://open.ezvizlife.com) -- cloud path,
 * used because the villa cameras are reached over the internet, not a
 * shared LAN with wherever Vercel runs this. Contract verified against
 * EZVIZ's own Open Platform docs before writing this (token/get response
 * shape, form-encoded POST body) -- see docs/project-memory/INTEGRATIONS.md.
 *
 * Requires a developer account at open.ezvizlife.com (EZVIZ_APP_KEY /
 * EZVIZ_APP_SECRET, account-level) plus, per camera, its serial number and
 * (if the stream is encrypted) verification code -- printed on the device
 * or visible in the EZVIZ app.
 */

const API_BASE = process.env.EZVIZ_API_BASE || "https://open.ezvizlife.com";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Account-level access token, cached in-process. Live-view (EZUIKit) needs
 * this token in the browser to authenticate the stream -- that's how
 * EZVIZ's own web SDK is designed, not a shortcut taken here. Only admin
 * sessions can reach the route that hands this out (see
 * /api/cctv/token/route.ts), and EZVIZ_APP_KEY/SECRET themselves never
 * leave this server.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const appKey = process.env.EZVIZ_APP_KEY;
  const appSecret = process.env.EZVIZ_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("EZVIZ_APP_KEY / EZVIZ_APP_SECRET is not configured");
  }

  const res = await fetch(`${API_BASE}/api/lapp/token/get`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ appKey, appSecret }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.code !== "200" || !data.data?.accessToken) {
    throw new Error(`EZVIZ token/get failed: ${data?.msg || res.status}`);
  }
  cachedToken = { token: data.data.accessToken, expiresAt: Number(data.data.expireTime) || Date.now() + 6 * 3600_000 };
  return cachedToken.token;
}
