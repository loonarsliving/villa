/**
 * Server-only client for Cloudbeds' self-service, property-level API key
 * auth (https://developers.cloudbeds.com/docs/quickstart-guide-api-authentication-for-property-level-users):
 * a long-lived key generated per-property under Account > Apps & Marketplace,
 * sent as the `x-api-key` header — no OAuth token exchange/refresh needed.
 *
 * Never import this from a "use client" file: CLOUDBEDS_API_KEY must stay
 * server-side, same as CLOUDBEDS_WEBHOOK_SECRET in the webhook route.
 */

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";

export class CloudbedsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface CloudbedsRoom {
  roomID: string;
  roomName: string;
  roomTypeID?: string;
  roomTypeName?: string;
}

function apiKey(): string {
  const key = (process.env.CLOUDBEDS_API_KEY ?? "").trim();
  if (!key) {
    throw new CloudbedsApiError("Cloudbeds API key belum dikonfigurasi (CLOUDBEDS_API_KEY)", 503);
  }
  return key;
}

/**
 * Fetches every room for the property tied to CLOUDBEDS_API_KEY.
 * CLOUDBEDS_PROPERTY_ID is optional — only needed if the key is scoped to a
 * group/multi-property account rather than a single property.
 */
export async function getCloudbedsRooms(): Promise<CloudbedsRoom[]> {
  const key = apiKey();
  const propertyId = (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim();
  const url = new URL(`${CLOUDBEDS_API_BASE}/getRooms`);
  if (propertyId) url.searchParams.set("propertyID", propertyId);

  const res = await fetch(url, {
    headers: { "x-api-key": key },
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);

  if (!res.ok || body?.success === false) {
    const message = body?.message || body?.error || `Cloudbeds API error (HTTP ${res.status})`;
    throw new CloudbedsApiError(message, res.status >= 400 ? res.status : 502);
  }

  const rooms = (body?.data ?? []) as Array<{
    roomID?: string;
    roomName?: string;
    roomTypeID?: string;
    roomTypeName?: string;
    rooms?: Array<{ roomID?: string; roomName?: string }>;
  }>;

  // getRooms groups rooms by room type in some accounts (each entry carrying
  // a nested `rooms` array) and returns a flat per-room list in others --
  // handle both shapes rather than assuming one.
  const flat: CloudbedsRoom[] = [];
  for (const entry of rooms) {
    if (Array.isArray(entry.rooms)) {
      for (const r of entry.rooms) {
        if (r.roomID) {
          flat.push({
            roomID: String(r.roomID),
            roomName: r.roomName || String(r.roomID),
            roomTypeID: entry.roomTypeID,
            roomTypeName: entry.roomTypeName,
          });
        }
      }
    } else if (entry.roomID) {
      flat.push({
        roomID: String(entry.roomID),
        roomName: entry.roomName || String(entry.roomID),
        roomTypeID: entry.roomTypeID,
        roomTypeName: entry.roomTypeName,
      });
    }
  }
  return flat;
}
