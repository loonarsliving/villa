import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkTransactionStatus } from "@/lib/ipaymuApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://svcmybsziaelwwdrnzcv.supabase.co";

/**
 * iPaymu notifyUrl callback receiver.
 *
 * We do NOT trust this request's payload or any signature on it to decide
 * a transaction is paid -- iPaymu v2's callback signature scheme wasn't
 * verifiable from this environment (docs.ipaymu.com unreachable), and an
 * unverified "yes it's paid" from the open internet is exactly the kind of
 * thing that shouldn't move real money-status. Instead this route only
 * uses the callback as a trigger to ask iPaymu itself, server-to-server,
 * with our own signed request (checkTransactionStatus) -- only THAT
 * response can mark something paid.
 *
 * Scope: only walkin_payments (cafe/spa/lainnya) are auto-marked lunas
 * here. Villa bookings ("villa_<booking id>" referenceId) are deliberately
 * NOT auto-checked-in from this webhook -- checkin has side effects (WA PIN
 * send, transaction recording for the 70/30 split, unit status change)
 * that should stay a deliberate staff action via the existing "Tandai
 * Lunas & Check-In" button, which now also gets a live iPaymu status check
 * (see /api/payment-gateway/qris/status) so staff aren't guessing.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let referenceId: string | null = null;
  try {
    if (contentType.includes("application/json")) {
      const body = await request.json();
      referenceId = body?.referenceId ?? body?.reference_id ?? null;
    } else {
      const form = await request.formData();
      referenceId = (form.get("referenceId") ?? form.get("reference_id")) as string | null;
    }
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  if (!referenceId || !referenceId.startsWith("walkin_")) {
    // Not a walk-in payment (villa booking, or malformed) -- acknowledge, no action.
    return NextResponse.json({ success: true, matched: false });
  }
  const walkinId = referenceId.slice("walkin_".length);

  let confirmedPaid = false;
  let logError: string | null = null;
  try {
    const status = await checkTransactionStatus(referenceId);
    confirmedPaid = status.paid;
  } catch (e) {
    logError = e instanceof Error ? e.message : String(e);
  }

  if (!confirmedPaid) {
    return NextResponse.json({ success: true, matched: false, error: logError });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi" }, { status: 503 });
  }
  const supabase = createClient(SUPABASE_URL, serviceRoleKey);

  const { data, error } = await supabase
    .from("walkin_payments")
    .update({ status: "lunas", paid_at: new Date().toISOString() })
    .eq("id", walkinId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, matched: !!data });
}
