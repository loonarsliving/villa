import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { createQrisPayment, IpaymuApiError } from "@/lib/ipaymuApi";
import { isStaffToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generates a real dynamic QRIS (via iPaymu) for one Payment Gateway
 * transaction -- replaces the previous "admin uploads a static photo" flow.
 * Staff-gated (admin or receptionist), same pattern as
 * /api/admin/cloudbeds/rooms. Returns 503 with a clear message if
 * IPAYMU_VA/IPAYMU_API_KEY aren't set yet, so the existing static-image
 * fallback in the UI keeps working until they are.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isStaffToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const kind = body?.kind === "villa" ? "villa" : "walkin";
  const refId: string | undefined = body?.refId;
  const amount = Number(body?.amount);
  const guestName: string = body?.guestName || "Tamu";
  const guestPhone: string | undefined = body?.guestPhone;
  const product: string = body?.product || "Pembayaran";

  if (!refId || !amount || amount <= 0) {
    return NextResponse.json({ error: "refId dan amount wajib diisi" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;

  try {
    const result = await createQrisPayment({
      amount,
      product,
      referenceId: `${kind}_${refId}`,
      buyerName: guestName,
      buyerPhone: guestPhone,
      notifyUrl: `${origin}/api/webhooks/ipaymu`,
    });

    let qrImageDataUrl: string | null = result.qrImageUrl;
    if (!qrImageDataUrl && result.qrPayload) {
      qrImageDataUrl = await QRCode.toDataURL(result.qrPayload, { margin: 1, width: 400 });
    }

    if (!qrImageDataUrl) {
      return NextResponse.json(
        { error: "iPaymu tidak mengembalikan data QRIS yang dikenali", raw: result.raw },
        { status: 502 },
      );
    }

    return NextResponse.json({ qrImageDataUrl, sessionId: result.sessionId });
  } catch (e) {
    if (e instanceof IpaymuApiError) {
      return NextResponse.json({ error: e.message, raw: e.raw }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal membuat QRIS" }, { status: 502 });
  }
}
