import { createHash, createHmac } from "node:crypto";

/**
 * Server-only client for iPaymu's REST API v2 (https://ipaymu.com), used to
 * generate a real dynamic QRIS per Payment Gateway transaction instead of
 * the previous "admin uploads a static photo" flow.
 *
 * Contract verified against iPaymu's own official source
 * (github.com/ipaymu/ipaymu-php-api, Config.php + Traits/CurlTrait.php) on
 * 2026-08-27:
 *   - Base URL: https://my.ipaymu.com/api/v2 (prod) / https://sandbox.ipaymu.com/api/v2 (sandbox)
 *   - POST /payment/direct creates a payment; POST /transaction checks status
 *   - signature = HMAC-SHA256(secretKey, "POST:" + va + ":" + sha256hex(JSON.stringify(body)) + ":" + secretKey)
 *   - headers: va, signature, timestamp (YmdHis), Content-Type: application/json
 *
 * NOT verified (docs.ipaymu.com and the official signature PDF were
 * unreachable from this environment): the exact JSON shape of a successful
 * /payment/direct response, and the webhook (notifyUrl) callback payload/
 * signature for API v2. Response parsing below is deliberately defensive
 * (tries several plausible field names, keeps the raw response for
 * debugging) rather than assuming a shape we haven't confirmed live. Verify
 * against a real sandbox call before relying on this in production, and
 * tighten `parsePaymentResponse` once the actual shape is known.
 */

const IPAYMU_BASE =
  (process.env.IPAYMU_ENV ?? "sandbox") === "production"
    ? "https://my.ipaymu.com/api/v2"
    : "https://sandbox.ipaymu.com/api/v2";

export class IpaymuApiError extends Error {
  status: number;
  raw?: unknown;
  constructor(message: string, status: number, raw?: unknown) {
    super(message);
    this.status = status;
    this.raw = raw;
  }
}

function credentials(): { va: string; apiKey: string } {
  const va = (process.env.IPAYMU_VA ?? "").trim();
  const apiKey = (process.env.IPAYMU_API_KEY ?? "").trim();
  if (!va || !apiKey) {
    throw new IpaymuApiError("iPaymu belum dikonfigurasi (IPAYMU_VA / IPAYMU_API_KEY)", 503);
  }
  return { va, apiKey };
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function signature(va: string, apiKey: string, body: unknown): string {
  const bodyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex").toLowerCase();
  const toSign = `POST:${va}:${bodyHash}:${apiKey}`;
  return createHmac("sha256", apiKey).update(toSign).digest("hex");
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const { va, apiKey } = credentials();
  const res = await fetch(`${IPAYMU_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      va,
      signature: signature(va, apiKey, body),
      timestamp: timestamp(),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new IpaymuApiError((data && (data.Message || data.message)) || `iPaymu API error (HTTP ${res.status})`, res.status, data);
  }
  return (data ?? {}) as Record<string, unknown>;
}

export interface CreateQrisInput {
  amount: number;
  product: string;
  referenceId: string;
  buyerName: string;
  buyerPhone?: string;
  buyerEmail?: string;
  notifyUrl: string;
}

export interface QrisPaymentResult {
  /** Either a ready-to-display QR image URL, or a raw EMVCo QRIS payload string to render into a QR image ourselves. */
  qrImageUrl: string | null;
  qrPayload: string | null;
  sessionId: string | null;
  raw: Record<string, unknown>;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function parsePaymentResponse(raw: Record<string, unknown>): QrisPaymentResult {
  const data = (raw.Data ?? raw.data ?? raw) as Record<string, unknown>;
  const qrCandidate = firstString(data, ["QrString", "qrString", "PaymentNo", "paymentNo", "Url", "url", "QrisContent"]);
  const isUrl = !!qrCandidate && /^https?:\/\//i.test(qrCandidate);
  return {
    qrImageUrl: isUrl ? qrCandidate : null,
    qrPayload: !isUrl ? qrCandidate : null,
    sessionId: firstString(data, ["SessionID", "sessionId", "TransactionId", "trx_id", "Trx"]),
    raw,
  };
}

export async function createQrisPayment(input: CreateQrisInput): Promise<QrisPaymentResult> {
  const raw = await post("/payment/direct", {
    product: [input.product],
    qty: [1],
    price: [input.amount],
    paymentMethod: "qris",
    name: input.buyerName,
    phone: input.buyerPhone || "-",
    email: input.buyerEmail || "guest@loonars.local",
    notifyUrl: input.notifyUrl,
    referenceId: input.referenceId,
  });
  return parsePaymentResponse(raw);
}

export interface TransactionStatusResult {
  paid: boolean;
  statusRaw: string | null;
  raw: Record<string, unknown>;
}

/**
 * Confirms payment status by calling iPaymu ourselves (server-to-server,
 * authenticated with our own signature) rather than trusting an inbound
 * webhook payload we can't yet verify -- see file header.
 */
export async function checkTransactionStatus(referenceId: string): Promise<TransactionStatusResult> {
  const raw = await post("/transaction", { referenceId });
  const data = (raw.Data ?? raw.data ?? raw) as Record<string, unknown>;
  const statusRaw = firstString(data, ["Status", "status", "StatusDesc", "status_desc"]);
  const paid = !!statusRaw && ["berhasil", "success", "paid", "1"].includes(statusRaw.toLowerCase());
  return { paid, statusRaw, raw };
}
