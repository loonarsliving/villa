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

export interface CloudbedsRoomTypeRate {
  date: string;
  rate: number;
}

/**
 * Fetches the live daily rate Cloudbeds has set for one room type over a
 * date range (GET /getRate, detailedRates=true) -- this is the same rate
 * already being distributed to every OTA through Cloudbeds' channel
 * manager, per owner instruction (2026-09-11) to make villa's own
 * tarif_harian follow it directly rather than maintain a separate price.
 */
export async function getCloudbedsRoomTypeRate(roomTypeId: string, startDate: string, endDate: string): Promise<CloudbedsRoomTypeRate[]> {
  const key = apiKey();
  const propertyId = (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim();
  const url = new URL(`${CLOUDBEDS_API_BASE}/getRate`);
  if (propertyId) url.searchParams.set("propertyID", propertyId);
  url.searchParams.set("roomTypeID", roomTypeId);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("detailedRates", "true");

  const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
  const body = await res.json().catch(() => null);

  if (!res.ok || body?.success === false) {
    const message = body?.message || body?.error || `Cloudbeds API error (HTTP ${res.status})`;
    throw new CloudbedsApiError(message, res.status >= 400 ? res.status : 502);
  }

  // Cloudbeds returns `data` as a single object for some properties and
  // as an array (one entry per rate plan) for others -- the same
  // shape ambiguity that silently broke the room-mapping join earlier.
  // Handle both rather than assuming, and log the raw body when nothing
  // parses, since a silent empty result here means every downstream
  // price is wrong without anything saying so.
  const data = body?.data;
  const entries = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    roomRateDetailed?: Array<{ date?: string; rate?: number | string }>;
  }>;

  // Cloudbeds sends every numeric field as a STRING ("650000.00"), so a
  // typeof === "number" check silently rejected every single row and the
  // whole rate mirror came back empty while reporting success.
  const out: CloudbedsRoomTypeRate[] = [];
  for (const entry of entries) {
    for (const r of entry?.roomRateDetailed ?? []) {
      const rate = Number(r.rate);
      if (r.date && Number.isFinite(rate) && rate > 0) out.push({ date: String(r.date), rate });
    }
  }

  if (out.length === 0) {
    console.log(
      "[cloudbeds-getRate] no detailed rates",
      JSON.stringify({ roomTypeId, startDate, endDate, raw: JSON.stringify(body ?? null).slice(0, 1500) }),
    );
  }
  return out;
}

/**
 * Looks up the base (non-derived) rateID for a room type -- required by
 * PUT /putRate, which can only update a non-derived rate. Returns null if
 * Cloudbeds' own rate for this room type is itself derived from another
 * rate plan (isDerived: true), since pushing to that would be rejected by
 * Cloudbeds -- caller should surface this rather than guess a different ID.
 */
export async function getCloudbedsBaseRateId(roomTypeId: string, onDate: string): Promise<string | null> {
  const key = apiKey();
  const propertyId = (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim();
  const url = new URL(`${CLOUDBEDS_API_BASE}/getRate`);
  if (propertyId) url.searchParams.set("propertyID", propertyId);
  url.searchParams.set("roomTypeID", roomTypeId);
  url.searchParams.set("startDate", onDate);
  url.searchParams.set("endDate", onDate);

  const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    const message = body?.message || body?.error || `Cloudbeds API error (HTTP ${res.status})`;
    throw new CloudbedsApiError(message, res.status >= 400 ? res.status : 502);
  }
  if (body?.data?.isDerived) return null;
  return typeof body?.data?.rateID === "string" ? body.data.rateID : null;
}

export interface RateInterval {
  startDate: string;
  endDate: string;
  rate: number;
}

/**
 * Pushes a new price to Cloudbeds via POST /putRate -- this is what
 * actually changes the price on every OTA, since Cloudbeds' channel
 * manager distributes it outward. Async on Cloudbeds' side (returns a
 * jobReferenceID, tracked via GET /getRateJobs if ever needed).
 * CLOUDBEDS_API_KEY was confirmed (2026-09-11, live test) to already
 * carry write:rate. `endDate` on each interval is EXCLUSIVE, like a
 * checkout date -- a single day must be [date, date+1), or Cloudbeds
 * rejects it with "endDate should be greater than startDate".
 */
export async function pushCloudbedsRate(rateId: string, intervals: RateInterval[]): Promise<{ jobReferenceId: string | null }> {
  const key = apiKey();
  const form = new URLSearchParams();
  form.set("rates[0][rateID]", rateId);
  intervals.forEach((iv, i) => {
    form.set(`rates[0][interval][${i}][startDate]`, iv.startDate);
    form.set(`rates[0][interval][${i}][endDate]`, iv.endDate);
    form.set(`rates[0][interval][${i}][rate]`, String(iv.rate));
  });

  const res = await fetch(`${CLOUDBEDS_API_BASE}/putRate`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    const message = body?.message || body?.error || `Cloudbeds API error (HTTP ${res.status})`;
    throw new CloudbedsApiError(message, res.status >= 400 ? res.status : 502);
  }
  return { jobReferenceId: typeof body?.jobReferenceID === "string" ? body.jobReferenceID : null };
}
