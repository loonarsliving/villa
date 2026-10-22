import { NextResponse } from "next/server";
import { getCloudbedsRooms, CloudbedsApiError } from "@/lib/cloudbedsApi";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daftar room di akun Cloudbeds Excellent Living (CLOUDBEDS2_API_KEY), untuk pemetaan kamar oleh admin. */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ rooms: await getCloudbedsRooms("el") });
  } catch (e) {
    if (e instanceof CloudbedsApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil data room Cloudbeds" }, { status: 502 });
  }
}
