import { NextResponse } from "next/server";
import { checkTransactionStatus, IpaymuApiError } from "@/lib/ipaymuApi";
import { isStaffToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only "is this actually paid according to iPaymu" check, so staff can
 * see a live confirmation in the Payment Gateway modal instead of guessing
 * -- especially for villa bookings, where check-in still requires a manual
 * staff click (see src/app/api/webhooks/ipaymu/route.ts for why).
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isStaffToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const kind = body?.kind === "villa" ? "villa" : "walkin";
  const refId: string | undefined = body?.refId;
  if (!refId) {
    return NextResponse.json({ error: "refId wajib diisi" }, { status: 400 });
  }

  try {
    const result = await checkTransactionStatus(`${kind}_${refId}`);
    return NextResponse.json({ paid: result.paid, statusRaw: result.statusRaw });
  } catch (e) {
    if (e instanceof IpaymuApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal cek status" }, { status: 502 });
  }
}
