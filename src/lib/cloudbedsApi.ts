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
  roomTypeNameShort?: string;
  /** Kamar diblokir (tutup/maintenance) pada hari ini, per getRooms pms-v1.2. */
  roomBlocked?: boolean;
  isVirtual?: boolean;
}

/**
 * Dua akun Cloudbeds: "utama" = Loonars Private Living (CLOUDBEDS_*),
 * "el" = Loonars Excellent Living (CLOUDBEDS2_*). Hanya getCloudbedsRooms
 * dan getCloudbedsReservationTotals yang menerima akun "el" -- fungsi
 * harga (getRate/putRate) sengaja tetap khusus akun utama.
 */
export type CloudbedsAkun = "utama" | "el";

/**
 * Nama env akun Excellent Living. Owner memasang kunci di Vercel dengan nama
 * `*_LOONARS2` (2026-11-01), sedangkan kode awalnya hanya membaca
 * `CLOUDBEDS2_*` -- keduanya diterima, nama `CLOUDBEDS2_*` menang bila ada.
 */
export const ENV_EL = {
  apiKey: ["CLOUDBEDS2_API_KEY", "CLOUDBEDS_API_KEY_LOONARS2"],
  propertyId: ["CLOUDBEDS2_PROPERTY_ID", "CLOUDBEDS_PROPERTY_ID_LOONARS2"],
  webhookSecret: ["CLOUDBEDS2_WEBHOOK_SECRET", "CLOUDBEDS_SECRET_LOONARS2"],
} as const;

/** Nilai env pertama yang terisi dari daftar nama. */
export function envPertama(nama: readonly string[], env: Record<string, string | undefined> = process.env): string {
  for (const n of nama) {
    const v = (env[n] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/**
 * Kunci EL yang terbukti diterima Cloudbeds oleh periksaKunciEl() pada
 * proses ini. Owner menyimpan "API key" dan "secret" EL di dua env; kalau
 * yang bernama API key ditolak tetapi yang satunya diterima, yang diterima
 * yang dipakai.
 */
let kunciElTerbukti: string | null = null;

function apiKey(akun: CloudbedsAkun = "utama"): string {
  if (akun === "el" && kunciElTerbukti) return kunciElTerbukti;
  const nama: readonly string[] = akun === "el" ? ENV_EL.apiKey : ["CLOUDBEDS_API_KEY"];
  const key = envPertama(nama);
  if (!key) {
    throw new CloudbedsApiError(`Cloudbeds API key belum dikonfigurasi (${nama.join(" / ")})`, 503);
  }
  return key;
}

function propertyIdAkun(akun: CloudbedsAkun): string {
  return akun === "el" ? envPertama(ENV_EL.propertyId) : (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim();
}

/** Bentuk sebuah kunci tanpa membuka isinya (aman dicatat di log). */
export function jenisKunci(v: string): "cbat_" | "live1_" | "lain" {
  if (v.startsWith("cbat_")) return "cbat_";
  if (v.startsWith("live1_")) return "live1_";
  return "lain";
}

/** Env yang dicoba sebagai kunci API akun EL, urut prioritas. */
export const KANDIDAT_KUNCI_EL = ["CLOUDBEDS2_API_KEY", "CLOUDBEDS_API_KEY_LOONARS2", "CLOUDBEDS_SECRET_LOONARS2"] as const;

export interface HasilPeriksaKunci {
  env: string;
  panjang: number;
  jenis: ReturnType<typeof jenisKunci>;
  http_x_api_key: number | null;
  http_bearer: number | null;
  pesan: string | null;
  properti: { id: string; nama: string }[];
}

/**
 * Mencoba setiap env kandidat ke Cloudbeds `getHotels` (header x-api-key,
 * lalu Authorization: Bearer). Kunci pertama yang diterima lewat x-api-key
 * dipakai untuk seluruh panggilan akun EL berikutnya. Hasilnya hanya
 * memuat nama env, panjang, dan awalan jenis -- tidak pernah isi kunci.
 */
export async function periksaKunciEl(env: Record<string, string | undefined> = process.env): Promise<{ terpilih: string | null; hasil: HasilPeriksaKunci[] }> {
  const hasil: HasilPeriksaKunci[] = [];
  let terpilih: string | null = null;
  for (const nama of KANDIDAT_KUNCI_EL) {
    const v = (env[nama] ?? "").trim();
    if (!v) continue;
    const coba = async (headers: Record<string, string>) => {
      try {
        const res = await fetch(`${CLOUDBEDS_API_BASE}/getHotels`, { headers, cache: "no-store" });
        const body = await res.json().catch(() => null);
        const ok = res.ok && body?.success !== false;
        return { status: res.status, ok, body };
      } catch (e) {
        return { status: null, ok: false, body: { message: e instanceof Error ? e.message : String(e) } };
      }
    };
    const a = await coba({ "x-api-key": v });
    const b = a.ok ? null : await coba({ Authorization: `Bearer ${v}` });
    const sukses = a.ok ? a : b?.ok ? b : null;
    const rows = Array.isArray(sukses?.body?.data) ? (sukses!.body.data as Array<Record<string, unknown>>) : [];
    hasil.push({
      env: nama,
      panjang: v.length,
      jenis: jenisKunci(v),
      http_x_api_key: a.status,
      http_bearer: b?.status ?? null,
      pesan: sukses ? null : String((b?.body ?? a.body)?.message ?? (b?.body ?? a.body)?.error ?? "ditolak").slice(0, 200),
      properti: rows.map((r) => ({ id: String(r.propertyID ?? ""), nama: String(r.propertyName ?? "") })).slice(0, 10),
    });
    if (a.ok && !terpilih) terpilih = nama;
  }
  kunciElTerbukti = terpilih ? (env[terpilih] ?? "").trim() : null;
  return { terpilih, hasil };
}

/** Kunci API + property ID satu akun (melempar CloudbedsApiError 503 bila kunci kosong). */
export function kredensialCloudbeds(akun: CloudbedsAkun): { apiKey: string; propertyId: string } {
  return { apiKey: apiKey(akun), propertyId: propertyIdAkun(akun) };
}

/**
 * Fetches every room for the property tied to CLOUDBEDS_API_KEY.
 * CLOUDBEDS_PROPERTY_ID is optional — only needed if the key is scoped to a
 * group/multi-property account rather than a single property.
 */
export async function getCloudbedsRooms(akun: CloudbedsAkun = "utama"): Promise<CloudbedsRoom[]> {
  const key = apiKey(akun);
  const propertyId = propertyIdAkun(akun);
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

  type RoomMentah = {
    roomID?: string;
    roomName?: string;
    roomTypeID?: string | number;
    roomTypeName?: string;
    roomTypeNameShort?: string;
    roomBlocked?: unknown;
    isVirtual?: unknown;
  };
  const rooms = (body?.data ?? []) as Array<RoomMentah & { rooms?: RoomMentah[] }>;
  // API ini sering mengirim boolean sebagai string ("1"/"true").
  const benar = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

  // getRooms groups rooms by room type in some accounts (each entry carrying
  // a nested `rooms` array) and returns a flat per-room list in others --
  // handle both shapes rather than assuming one. Per spec pms-v1.2 the
  // nested rooms carry their own roomTypeID/roomTypeName, so those win over
  // the wrapper's.
  const flat: CloudbedsRoom[] = [];
  const dorong = (r: RoomMentah, wadah: RoomMentah) => {
    if (!r.roomID) return;
    const tipe = r.roomTypeID ?? wadah.roomTypeID;
    flat.push({
      roomID: String(r.roomID),
      roomName: r.roomName || String(r.roomID),
      roomTypeID: tipe != null ? String(tipe) : undefined,
      roomTypeName: r.roomTypeName ?? wadah.roomTypeName,
      roomTypeNameShort: r.roomTypeNameShort ?? wadah.roomTypeNameShort,
      roomBlocked: benar(r.roomBlocked),
      isVirtual: benar(r.isVirtual),
    });
  };
  for (const entry of rooms) {
    if (Array.isArray(entry.rooms)) for (const r of entry.rooms) dorong(r, entry);
    else dorong(entry, entry);
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
export async function getCloudbedsRoomTypeRate(roomTypeId: string, startDate: string, endDate: string, akun: CloudbedsAkun = "utama"): Promise<CloudbedsRoomTypeRate[]> {
  const key = apiKey(akun);
  const propertyId = propertyIdAkun(akun);
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

  // getRate rejects startDate === endDate ("Parameter endDate should be
  // greater than startDate"). This lookup ran BEFORE every push, so that
  // one rejection was what actually blocked the whole autopilot -- the
  // error was misread as coming from putRate.
  const next = new Date(`${onDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);

  const url = new URL(`${CLOUDBEDS_API_BASE}/getRate`);
  if (propertyId) url.searchParams.set("propertyID", propertyId);
  url.searchParams.set("roomTypeID", roomTypeId);
  url.searchParams.set("startDate", onDate);
  url.searchParams.set("endDate", next.toISOString().slice(0, 10));

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
 * carry write:rate.
 *
 * `endDate` here is INCLUSIVE -- established by probing one far-future
 * date: sending [Mar 2, Mar 3] set BOTH days, and [Mar 6, Mar 6] is
 * accepted for a single night. So one night is [date, date], NOT
 * [date, date+1); the latter silently bleeds each price into the
 * following day. (Note this is the opposite of getRate, which rejects
 * startDate === endDate -- the two endpoints do not agree, so neither
 * can be assumed from the other.)
 *
 * Sent in batches of MAX_INTERVALS_PER_CALL. Established the hard way on
 * 2026-09-12, the first time a full year was pushed: 365 single-day
 * intervals encode to 3 form fields each, 1,096 in total, and Cloudbeds
 * answered "The endDate parameter value is missing". That is the
 * signature of PHP's default max_input_vars = 1000 -- everything past
 * the thousandth field is dropped silently, so the last intervals arrive
 * with a startDate and no endDate. Nothing in the response says so.
 * 90 intervals (271 fields) leaves a wide margin.
 */
const MAX_INTERVALS_PER_CALL = 90;

export async function pushCloudbedsRate(rateId: string, intervals: RateInterval[]): Promise<{ jobReferenceId: string | null }> {
  const key = apiKey();
  let lastJobReferenceId: string | null = null;

  for (let offset = 0; offset < intervals.length; offset += MAX_INTERVALS_PER_CALL) {
    const batch = intervals.slice(offset, offset + MAX_INTERVALS_PER_CALL);
    const form = new URLSearchParams();
    form.set("rates[0][rateID]", rateId);
    batch.forEach((iv, i) => {
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
      throw new CloudbedsApiError(`${message} (batch ${offset / MAX_INTERVALS_PER_CALL + 1}, ${batch[0]?.startDate}..${batch[batch.length - 1]?.endDate})`, res.status >= 400 ? res.status : 502);
    }
    if (typeof body?.jobReferenceID === "string") lastJobReferenceId = body.jobReferenceID;
  }

  return { jobReferenceId: lastJobReferenceId };
}

/**
 * Collapses consecutive dates that carry the same price into one
 * interval, which is what a Cloudbeds interval is for. A year priced on
 * a weekday/weekend pattern is only a few hundred single days but far
 * fewer runs, so this cuts the request size several times over before
 * batching even applies -- and it is what a human would send.
 *
 * Requires `decisions` sorted ascending by date; a gap in the dates
 * correctly ends a run, so a missing day is never silently filled in.
 */
export function collapseRateIntervals(decisions: { date: string; rate: number }[]): RateInterval[] {
  const out: RateInterval[] = [];
  for (const d of decisions) {
    const last = out[out.length - 1];
    const isNextDay = last ? Date.parse(`${d.date}T00:00:00Z`) - Date.parse(`${last.endDate}T00:00:00Z`) === 86400000 : false;
    if (last && last.rate === d.rate && isNextDay) {
      last.endDate = d.date;
    } else {
      out.push({ startDate: d.date, endDate: d.date, rate: d.rate });
    }
  }
  return out;
}

export interface ReservationTotals {
  /** Sum of subTotal + additionalItems + taxesFees -- what the guest owes. */
  grandTotal: number;
  /** Sum of the room prices only, before extras and taxes. */
  subTotal: number;
  /** Cloudbeds' per-date room rate map, keyed YYYY-MM-DD. */
  detailedRates: Record<string, number>;
}

/**
 * Fetches the money side of reservations, keyed by reservationID.
 *
 * Why a separate call: `getReservations` has NO total field at all --
 * verified against the cached OpenAPI spec (pms-v1.2), whose
 * GetReservationsResponse carries only `balance`. The backfill and the
 * webhook both read `resv.total`, which is therefore always `undefined`,
 * so every Cloudbeds booking landed with `tarif = 0` and `total_bayar =
 * 0` and counted as zero revenue in reporting. `balance` would have been
 * wrong too -- it is what is still OWED, not what the stay costs, so a
 * fully prepaid OTA booking reads 0 there as well.
 *
 * `getReservationsWithRateDetails` is the endpoint that actually carries
 * it, under `balanceDetailed` (subTotal / grandTotal) plus a
 * `detailedRates` per-date map. Every numeric field arrives as a STRING
 * here like everywhere else in this API, so each one is coerced.
 *
 * Returns an empty map rather than throwing when the call comes back
 * empty: a missing total must never block a booking from being recorded.
 */
export interface CloudbedsDateAvailability {
  date: string;
  bookable: boolean;
  roomTypes: { name: string; available: number; rate: number | null }[];
  error?: string;
}

/**
 * "Kalau tamu membuka Booking.com hari ini, apakah tanggal ini muncul?"
 *
 * getAvailableRoomTypes adalah satu-satunya endpoint yang menjawab itu apa
 * adanya: ia sudah memperhitungkan kamar terjual, kamar yang ditutup, dan
 * SEMUA pembatasan (minimum menginap, closed-to-arrival, stop-sell). Membaca
 * tabel rate saja tidak cukup -- harga bisa terpasang rapi sementara
 * tanggalnya tidak bisa dipesan siapa pun, dan dari sisi kita keduanya
 * terlihat sama-sama sehat.
 *
 * Murni baca: tidak ada satu pun nilai yang diubah di Cloudbeds.
 */
export async function getCloudbedsAvailabilityForDate(
  date: string,
  nextDate: string,
  adults = 2,
): Promise<CloudbedsDateAvailability> {
  const key = apiKey();
  const propertyId = (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim();
  const url = new URL(`${CLOUDBEDS_API_BASE}/getAvailableRoomTypes`);
  if (propertyId) url.searchParams.set("propertyIDs", propertyId);
  url.searchParams.set("startDate", date);
  url.searchParams.set("endDate", nextDate);
  url.searchParams.set("rooms", "1");
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("children", "0");

  const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    return {
      date,
      bookable: false,
      roomTypes: [],
      error: body?.message || body?.error || `HTTP ${res.status}`,
    };
  }

  // Jawabannya dibungkus per properti: data[].propertyRooms[].
  const properties = Array.isArray(body?.data) ? body.data : [];
  const roomTypes: { name: string; available: number; rate: number | null }[] = [];
  for (const prop of properties) {
    for (const rt of prop?.propertyRooms ?? []) {
      const available = Number(rt?.roomsAvailable ?? 0);
      const rate = Number(rt?.roomRate);
      roomTypes.push({
        name: String(rt?.roomTypeName ?? rt?.roomTypeNameShort ?? "?"),
        available: Number.isFinite(available) ? available : 0,
        rate: Number.isFinite(rate) ? rate : null,
      });
    }
  }
  return { date, bookable: roomTypes.some((r) => r.available > 0), roomTypes };
}

/**
 * Blokir kamar (room block) di rentang tanggal tertentu.
 *
 * Kalau sebuah tanggal tidak bisa dipesan padahal harganya terpasang, blokir
 * kamar adalah tersangka pertama -- dan satu-satunya yang bisa dilihat lewat
 * API, bukan hanya di dashboard. Batas Cloudbeds: rentang maksimal 35 hari.
 */
export async function getCloudbedsRoomBlocks(startDate: string, endDate: string, akun: CloudbedsAkun = "utama"): Promise<unknown[]> {
  const key = apiKey(akun);
  const propertyId = propertyIdAkun(akun);
  const url = new URL(`${CLOUDBEDS_API_BASE}/getRoomBlocks`);
  if (propertyId) url.searchParams.set("propertyID", propertyId);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);

  const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new CloudbedsApiError(body?.message || body?.error || `Cloudbeds getRoomBlocks error (HTTP ${res.status})`, res.status >= 400 ? res.status : 502);
  }
  return Array.isArray(body?.data) ? body.data : [];
}

/**
 * Rate plan yang BENAR-BENAR terjual untuk rentang tanggal tertentu.
 *
 * Ini pertanyaan yang berbeda dari "berapa harganya" (getRate) dan dari
 * "berapa kamar tersisa" (getAvailableRoomTypes). Sebuah tanggal bisa punya
 * harga tersimpan rapi dan kamar kosong belas-belasan, tapi tetap tidak
 * muncul di mana pun karena tidak ada satu pun rate plan yang berlaku untuk
 * tanggal itu -- misalnya masa berlakunya baru mulai belakangan, atau ada
 * pembatasan kedatangan. Jawabannya biasanya membawa minStay, maxStay, dan
 * penanda closed-to-arrival, yang menyebut penyebabnya dengan namanya
 * sendiri alih-alih menyisakan tebakan.
 */
export async function getCloudbedsRatePlans(startDate: string, endDate: string): Promise<unknown[]> {
  const key = apiKey();
  const propertyId = (process.env.CLOUDBEDS_PROPERTY_ID ?? "").trim();
  const url = new URL(`${CLOUDBEDS_API_BASE}/getRatePlans`);
  if (propertyId) url.searchParams.set("propertyIDs", propertyId);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("adults", "2");
  url.searchParams.set("children", "0");
  url.searchParams.set("rooms", "1");
  url.searchParams.set("detailedRates", "true");

  const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new CloudbedsApiError(body?.message || body?.error || `Cloudbeds getRatePlans error (HTTP ${res.status})`, res.status >= 400 ? res.status : 502);
  }
  return Array.isArray(body?.data) ? body.data : [];
}

export async function getCloudbedsReservationTotals(params: {
  checkOutFrom?: string;
  reservationIDs?: string[];
}, akun: CloudbedsAkun = "utama"): Promise<Map<string, ReservationTotals>> {
  const key = apiKey(akun);
  const propertyId = propertyIdAkun(akun);
  const wanted = params.reservationIDs ? new Set(params.reservationIDs) : null;
  const out = new Map<string, ReservationTotals>();

  let pageNumber = 1;
  for (;;) {
    const url = new URL(`${CLOUDBEDS_API_BASE}/getReservationsWithRateDetails`);
    if (propertyId) url.searchParams.set("propertyID", propertyId);
    if (params.checkOutFrom) url.searchParams.set("checkOutFrom", params.checkOutFrom);
    url.searchParams.set("pageNumber", String(pageNumber));
    url.searchParams.set("pageSize", "100");

    const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success === false) return out;

    const rows: unknown[] = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
    if (rows.length === 0) return out;

    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const id = typeof r.reservationID === "string" ? r.reservationID : null;
      if (!id || (wanted && !wanted.has(id))) continue;

      const detailed = (r.balanceDetailed ?? {}) as Record<string, unknown>;
      const rates: Record<string, number> = {};
      if (r.detailedRates && typeof r.detailedRates === "object") {
        for (const [date, value] of Object.entries(r.detailedRates as Record<string, unknown>)) {
          const n = Number(value);
          if (Number.isFinite(n)) rates[date] = n;
        }
      }
      const grandTotal = Number(detailed.grandTotal);
      const subTotal = Number(detailed.subTotal);
      out.set(id, {
        grandTotal: Number.isFinite(grandTotal) ? grandTotal : 0,
        subTotal: Number.isFinite(subTotal) ? subTotal : 0,
        detailedRates: rates,
      });
    }

    if (rows.length < 100) return out;
    pageNumber++;
    if (pageNumber > 50) return out;
  }
}


/**
 * Sisa kamar yang BENAR-BENAR dibuka untuk dijual, per tipe kamar Cloudbeds
 * per tanggal: Map<roomTypeID, Map<YYYY-MM-DD, roomsAvailable>>.
 *
 * Dipakai mesin harga untuk menghitung okupansi dari inventori yang dijual,
 * bukan dari jumlah unit yang dimiliki (owner sengaja membuka sebagian unit
 * saja -- 5 dari 10 Standard sampai 15 Okt 2026, 9 setelahnya). Diambil dari
 * getRatePlans detailedRates, endpoint yang sama dengan alat diagnosis
 * /api/admin/cloudbeds/health. Kalau satu tipe punya beberapa rate plan,
 * diambil roomsAvailable terbesar (rate plan turunan tidak menambah kamar).
 */
export function parseRoomsAvailableByRoomType(plans: unknown[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const raw of plans) {
    const p = raw as { roomTypeID?: unknown; roomRateDetailed?: unknown };
    const rtId = p.roomTypeID != null ? String(p.roomTypeID) : "";
    if (!rtId || !Array.isArray(p.roomRateDetailed)) continue;
    if (!out.has(rtId)) out.set(rtId, new Map());
    const byDate = out.get(rtId)!;
    for (const d of p.roomRateDetailed as { date?: unknown; roomsAvailable?: unknown }[]) {
      const date = typeof d.date === "string" ? d.date.slice(0, 10) : "";
      const n = Number(d.roomsAvailable);
      if (!date || !Number.isFinite(n) || n < 0) continue;
      byDate.set(date, Math.max(byDate.get(date) ?? 0, n));
    }
  }
  return out;
}

export async function getCloudbedsRoomsAvailableByRoomType(startDate: string, endDate: string): Promise<Map<string, Map<string, number>>> {
  return parseRoomsAvailableByRoomType(await getCloudbedsRatePlans(startDate, endDate));
}
