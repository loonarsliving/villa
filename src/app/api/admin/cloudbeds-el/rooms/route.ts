import { NextResponse } from "next/server";
import { getCloudbedsRooms, CloudbedsApiError, periksaKunciEl } from "@/lib/cloudbedsApi";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daftar room di akun Cloudbeds Excellent Living (CLOUDBEDS2_API_KEY), untuk pemetaan kamar oleh admin. */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Pilih kunci EL yang diterima Cloudbeds (API key / secret) sebelum membaca room.
  const periksa = await periksaKunciEl();
  if (!periksa.terpilih) {
    const ringkas = periksa.hasil.map((h) => `${h.env}: HTTP ${h.http_x_api_key ?? "-"}${h.pesan ? ` (${h.pesan})` : ""}`).join("; ");
    return NextResponse.json(
      { error: periksa.hasil.length ? `Cloudbeds menolak kunci Excellent Living -- ${ringkas}` : "Kunci Cloudbeds Excellent Living belum diisi", kunci: periksa },
      { status: periksa.hasil.length ? 401 : 503 },
    );
  }
  try {
    return NextResponse.json({ rooms: await getCloudbedsRooms("el"), kunci_dipakai: periksa.terpilih });
  } catch (e) {
    if (e instanceof CloudbedsApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil data room Cloudbeds" }, { status: 502 });
  }
}
