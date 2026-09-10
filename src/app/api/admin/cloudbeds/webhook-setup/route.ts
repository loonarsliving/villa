import { NextResponse } from "next/server";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click Cloudbeds webhook registration, added 2026-09-10 because manual
 * dashboard registration (Settings > Apps & Integrations > Webhooks) kept
 * being the blocker for the inbound OTA->villa sync. Cloudbeds does support
 * programmatic subscription (POST /postWebhook, verified against their
 * published OpenAPI spec, pms-v1.2) -- but the exact valid `object`/`action`
 * string pairs are only documented on their separate Webhooks guide
 * (integrations.cloudbeds.com), which this environment cannot reach to
 * verify. So this tries the handful of pairs most consistent with their own
 * documented event-type examples ("reservation.created" etc, already used
 * by our own webhook route) and returns Cloudbeds' own raw response for
 * each attempt -- a rejection here will typically name the valid values,
 * which is more trustworthy than guessing silently.
 */

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";
const WEBHOOK_ENDPOINT_URL = "https://living.haluoleo.id/api/webhooks/cloudbeds";
const CANDIDATE_EVENTS: Array<{ object: string; action: string }> = [
  { object: "reservation", action: "create" },
  { object: "reservation", action: "modify" },
  { object: "reservation", action: "cancel" },
];

export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = (process.env.CLOUDBEDS_API_KEY ?? "").trim();
  const webhookSecret = (process.env.CLOUDBEDS_WEBHOOK_SECRET ?? "").trim();
  if (!apiKey) {
    return NextResponse.json({ error: "CLOUDBEDS_API_KEY belum dikonfigurasi" }, { status: 503 });
  }
  if (!webhookSecret) {
    return NextResponse.json({ error: "CLOUDBEDS_WEBHOOK_SECRET belum dikonfigurasi" }, { status: 503 });
  }

  const existingRes = await fetch(`${CLOUDBEDS_API_BASE}/getWebhooks`, { headers: { "x-api-key": apiKey } });
  const existingBody = await existingRes.json().catch(() => null);
  const existing = (existingBody?.data ?? []) as Array<{ event?: { entity?: string; action?: string }; subscriptionData?: { endpoint?: string } }>;
  const alreadyRegistered = existing.filter((s) => s.subscriptionData?.endpoint === WEBHOOK_ENDPOINT_URL);

  const attempts: Array<{ object: string; action: string; success: boolean; subscriptionID?: string; error?: string }> = [];
  for (const ev of CANDIDATE_EVENTS) {
    const alreadyHas = alreadyRegistered.some((s) => s.event?.entity === ev.object && s.event?.action === ev.action);
    if (alreadyHas) {
      attempts.push({ ...ev, success: true, error: "already_subscribed" });
      continue;
    }
    const form = new URLSearchParams();
    form.set("object", ev.object);
    form.set("action", ev.action);
    form.set("endpointUrl", WEBHOOK_ENDPOINT_URL);
    form.set("authHeaderName", "x-cloudbeds-secret");
    form.set("authHeaderValue", webhookSecret);

    const res = await fetch(`${CLOUDBEDS_API_BASE}/postWebhook`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.success !== false) {
      attempts.push({ ...ev, success: true, subscriptionID: body?.data?.subscriptionID });
    } else {
      attempts.push({ ...ev, success: false, error: body?.message || body?.error || `HTTP ${res.status}` });
    }
  }

  return NextResponse.json({
    endpoint_url: WEBHOOK_ENDPOINT_URL,
    already_registered_before: alreadyRegistered.length,
    attempts,
  });
}
