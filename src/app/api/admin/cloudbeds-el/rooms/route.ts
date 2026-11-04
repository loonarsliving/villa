import { NextResponse } from "next/server";
import { getCloudbedsRooms, CloudbedsApiError } from "@/lib/cloudbedsApi";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";
import { isAdminToken, propertiNonPl } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daftar room di akun Cloudbeds satu properti non-PL (?properti=XX, bawaan EL), untuk pemetaan kamar oleh admin. */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const kode = propertiNonPl(request, token);
  if (!kode) return NextResponse.json({ error: "properti tidak valid" }, { status: 400 });
  try {
    const { akun, periksa } = await siapkanAkunCloudbeds(kode);
    return NextResponse.json({ rooms: await getCloudbedsRooms(akun), kunci_dipakai: periksa.terpilih });
  } catch (e) {
    if (e instanceof CloudbedsApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal mengambil data room Cloudbeds" }, { status: 502 });
  }
}
