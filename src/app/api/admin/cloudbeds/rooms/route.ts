import { NextResponse } from "next/server";
import { getCloudbedsRooms, CloudbedsApiError } from "@/lib/cloudbedsApi";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxies Cloudbeds' /getRooms to the admin mapping UI so it can offer a
 * live room picker instead of manual Room ID entry. Read-only, keyed by
 * CLOUDBEDS_API_KEY (server-side only) -- returns 503 until that env var is
 * set, same fail-soft pattern as the Cloudbeds webhook route. Requires a
 * valid admin x-villa-token so an unauthenticated caller can't trigger
 * Cloudbeds API calls just by reaching this Vercel deployment.
 */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rooms = await getCloudbedsRooms();
    return NextResponse.json({ rooms });
  } catch (e) {
    if (e instanceof CloudbedsApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil data room Cloudbeds" }, { status: 502 });
  }
}
