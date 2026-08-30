import { NextResponse } from "next/server";
import { isAdminToken } from "@/lib/villaApiAuth";
import { getAccessToken } from "@/lib/ezviz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hands out an EZVIZ access token + the caller's regional areaDomain to the
 * browser for the EZUIKit live-view player -- EZVIZ's own web SDK
 * architecture requires this (accessToken is passed straight into
 * EZUIKitPlayer client-side), there's no way to keep it purely server-side
 * while still using their official player. Only the account-level token
 * leaves this server; EZVIZ_APP_KEY/SECRET never do. Admin-gated per
 * owner's explicit access decision for the CCTV feature.
 */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { accessToken, areaDomain } = await getAccessToken();
    return NextResponse.json({ accessToken, domain: areaDomain });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil token EZVIZ" }, { status: 503 });
  }
}
