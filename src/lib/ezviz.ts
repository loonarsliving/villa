import "server-only";

/**
 * EZVIZ Open Platform client (https://open.ezvizlife.com) -- cloud path,
 * used because the villa cameras are only reachable over the internet, not
 * a shared LAN with wherever this cron runs (see EZVIZ_API_BASE for the
 * China-region alternative, open.ys7.com, if that's ever needed instead).
 *
 * Requires a developer account at open.ezvizlife.com (EZVIZ_APP_KEY /
 * EZVIZ_APP_SECRET, account-level) plus, per camera, its serial number and
 * verification code (printed on the device / visible in the EZVIZ app).
 */

const API_BASE = process.env.EZVIZ_API_BASE || "https://open.ezvizlife.com";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
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

export interface EzvizSnapshot {
  picUrl: string;
  imageBase64: string;
  mimeType: string;
}

/**
 * Captures a fresh still image from a camera (EZVIZ's "capture" endpoint --
 * this is a real-time snapshot, not a cached thumbnail) and downloads it as
 * base64 so it can be sent straight to Gemini Vision without a second
 * server needing to fetch picUrl before it expires.
 */
export async function captureSnapshot(deviceSerial: string, channelNo: number, verificationCode?: string | null): Promise<EzvizSnapshot> {
  const accessToken = await getAccessToken();

  const params = new URLSearchParams({
    accessToken,
    deviceSerial,
    channelNo: String(channelNo || 1),
  });
  const res = await fetch(`${API_BASE}/api/lapp/device/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.code !== "200" || !data.data?.picUrl) {
    throw new Error(`EZVIZ device/capture failed for ${deviceSerial}: ${data?.msg || res.status}`);
  }

  let picUrl: string = data.data.picUrl;
  if (verificationCode) {
    picUrl += (picUrl.includes("?") ? "&" : "?") + `verificationCode=${encodeURIComponent(verificationCode)}`;
  }

  const imgRes = await fetch(picUrl);
  if (!imgRes.ok) {
    throw new Error(`Failed to download EZVIZ snapshot image: HTTP ${imgRes.status}`);
  }
  const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { picUrl: data.data.picUrl, imageBase64: buffer.toString("base64"), mimeType };
}
