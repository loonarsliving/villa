import "server-only";

/**
 * EZVIZ Open Platform client -- cloud path, used because the villa cameras
 * are reached over the internet, not a shared LAN with wherever Vercel runs
 * this. Contract verified against EZVIZ's own official token/get docs
 * (pasted in by the owner directly from their EZVIZ developer console) --
 * see docs/project-memory/INTEGRATIONS.md.
 *
 * IMPORTANT per that doc: token/get itself is always called against the
 * global entry point https://open.ezvizlife.com, regardless of the
 * developer's account region -- EZVIZ_API_BASE should normally stay unset.
 * The response's `areaDomain` field is the user's actual regional API
 * domain, and *that* (not EZVIZ_API_BASE) is what every other call --
 * including the EZUIKit live-view player's `env.domain` -- must use. Mixing
 * these up (pointing token/get itself at a regional domain) is exactly what
 * caused the "appKey does not exist" / fetch failures while getting this
 * working.
 *
 * Requires a developer account at open.ezvizlife.com (EZVIZ_APP_KEY /
 * EZVIZ_APP_SECRET, account-level) plus, per camera, its serial number and
 * (if the stream is encrypted) verification code -- printed on the device
 * or visible in the EZVIZ app.
 */

const TOKEN_ENDPOINT_BASE = (process.env.EZVIZ_API_BASE || "https://open.ezvizlife.com").trim();

let cachedToken: { token: string; expiresAt: number; areaDomain: string } | null = null;

/**
 * Account-level access token + the caller's regional areaDomain, cached
 * in-process together since both come from the same token/get response.
 * Live-view (EZUIKit) needs the token in the browser to authenticate the
 * stream, and areaDomain to know which regional API to talk to -- that's
 * how EZVIZ's own web SDK is designed, not a shortcut taken here. Only
 * admin sessions can reach the route that hands these out (see
 * /api/cctv/token/route.ts), and EZVIZ_APP_KEY/SECRET themselves never
 * leave this server.
 */
export async function getAccessToken(): Promise<{ accessToken: string; areaDomain: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { accessToken: cachedToken.token, areaDomain: cachedToken.areaDomain };
  }
  // Trimmed defensively -- proven during setup that copy-pasting into
  // Vercel's env var UI (or a terminal) can silently carry a trailing
  // newline/space/stray quote along with the real value, which breaks an
  // exact-match check like EZVIZ's without ever showing up visibly.
  const appKey = process.env.EZVIZ_APP_KEY?.trim();
  const appSecret = process.env.EZVIZ_APP_SECRET?.trim();
  if (!appKey || !appSecret) {
    throw new Error("EZVIZ_APP_KEY / EZVIZ_APP_SECRET is not configured");
  }

  const res = await fetch(`${TOKEN_ENDPOINT_BASE}/api/lapp/token/get`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ appKey, appSecret }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.code !== "200" || !data.data?.accessToken) {
    // A same-length-but-still-failing appKey means trim() alone isn't the
    // full story -- it only strips whitespace, not e.g. an invisible
    // zero-width character that can survive a copy from some UIs. None of
    // this is sensitive: length, first/last 4 chars, and "is it clean
    // alphanumeric" are all things already visible in the Vercel dashboard
    // screenshot itself, just re-derived here so a mismatch shows up in the
    // error text without another round of screenshots.
    const isCleanAlnum = /^[a-zA-Z0-9]+$/.test(appKey);
    const preview = appKey.length >= 8 ? `${appKey.slice(0, 4)}...${appKey.slice(-4)}` : "(too short)";
    // appSecret's length only, never its value or a preview -- appKey is
    // already known non-sensitive (visible in the EZVIZ console UI), but
    // appSecret is a real credential. Length alone still rules "unset" /
    // "obviously truncated" in or out without exposing anything.
    const secretLen = appSecret.length;
    throw new Error(
      `EZVIZ token/get failed: ${data?.msg || res.status} ` +
        `(appKey.length=${appKey.length}, appKey=${preview}, cleanAlnum=${isCleanAlnum}, ` +
        `appSecret.length=${secretLen}, base=${TOKEN_ENDPOINT_BASE})`
    );
  }
  const areaDomain: string = data.data.areaDomain || TOKEN_ENDPOINT_BASE;
  cachedToken = {
    token: data.data.accessToken,
    expiresAt: Number(data.data.expireTime) || Date.now() + 6 * 3600_000,
    areaDomain,
  };
  return { accessToken: cachedToken.token, areaDomain: cachedToken.areaDomain };
}
