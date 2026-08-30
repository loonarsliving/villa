import { NextResponse } from "next/server";
import { isAdminToken } from "@/lib/villaApiAuth";
import { getLiveAddress } from "@/lib/ezviz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hands out a short-lived HLS live-stream URL for one camera (query params
 * deviceSerial/channelNo), for a plain <video>+hls.js player. EZVIZ_APP_KEY/
 * SECRET never leave this server -- only the resulting stream URL +
 * expireTime do. Admin-gated, same as /api/cctv/token. Not wired into the
 * /admin/cctv page yet (that still uses the EZUIKit player) -- prepared for
 * a future hls.js-based player.
 */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const deviceSerial = searchParams.get("deviceSerial");
  const channelNoParam = searchParams.get("channelNo");
  if (!deviceSerial || !channelNoParam) {
    return NextResponse.json({ error: "deviceSerial dan channelNo wajib diisi" }, { status: 400 });
  }
  const channelNo = Number(channelNoParam);
  if (!Number.isFinite(channelNo)) {
    return NextResponse.json({ error: "channelNo tidak valid" }, { status: 400 });
  }

  try {
    const { url, expireTime } = await getLiveAddress(deviceSerial, channelNo);
    return NextResponse.json({ url, expireTime });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil URL HLS" }, { status: 503 });
  }
}
