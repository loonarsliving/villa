import { NextResponse } from "next/server";
import { getCloudbedsRooms, CloudbedsApiError } from "@/lib/cloudbedsApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxies Cloudbeds' /getRooms to the admin mapping UI so it can offer a
 * live room picker instead of manual Room ID entry. Read-only, keyed by
 * CLOUDBEDS_API_KEY (server-side only) -- returns 503 until that env var is
 * set, same fail-soft pattern as the Cloudbeds webhook route.
 *
 * Note: like the rest of this repo's own routes (see CURRENT_STATE.md), this
 * does not itself enforce villa-api role auth -- the /admin/cloudbeds page
 * that calls it is already gated client-side to the admin role.
 */
export async function GET() {
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
