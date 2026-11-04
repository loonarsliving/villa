import { NextResponse } from "next/server";

import { kredensialCloudbeds } from "@/lib/cloudbedsApi";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";

/**
 * Jembatan Cloudbeds untuk villa-api, khusus properti selain Private Living
 * (multi-properti 2026-11-04: "kesiapan kamar harusnya bisa dan dsesuaikan
 * dgan cloudbeds el"). Kunci Cloudbeds Excellent Living hanya ada di Vercel
 * (CLOUDBEDS_API_KEY_LOONARS2), sedangkan modul Kesiapan Kamar ada di
 * villa-api; villa-api memanggil rute ini dengan rahasia cron yang sama
 * (integration_settings.cron.secret, diterima isAuthorizedCronRequest).
 *
 * SENGAJA SEMPIT: hanya room block (baca/buat/ubah/hapus) dan daftar kamar
 * -- yang dipakai Kesiapan Kamar (owner 2026-11-04: "Ya buat dia bisa buka
 * tutup kamar", setelah kamar Cloudbeds EL 1:1 dengan kamar sistem). Tidak
 * ada harga, reservasi, atau endpoint lain.
 */
const DIIZINKAN: Record<string, string[]> = {
  getRoomBlocks: ["GET"],
  getRooms: ["GET"],
  postRoomBlock: ["POST"],
  putRoomBlock: ["PUT"],
  deleteRoomBlock: ["POST"],
};

export async function POST(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { properti?: string; method?: string; endpoint?: string; query?: [string, string][]; form?: string | null };
  const kode = String(b.properti ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(kode) || kode === "PL") return NextResponse.json({ error: "properti tidak didukung" }, { status: 400 });
  const endpoint = String(b.endpoint ?? "");
  const method = String(b.method ?? "GET").toUpperCase();
  if (!DIIZINKAN[endpoint]?.includes(method)) return NextResponse.json({ error: "endpoint tidak diizinkan" }, { status: 400 });

  let apiKey: string, propertyId: string;
  try {
    const { akun } = await siapkanAkunCloudbeds(kode);
    ({ apiKey, propertyId } = kredensialCloudbeds(akun));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }

  const url = new URL(`${CLOUDBEDS_API_BASE}/${endpoint}`);
  for (const [k, v] of Array.isArray(b.query) ? b.query : []) if (k !== "propertyID") url.searchParams.set(String(k), String(v));
  let body: string | undefined;
  if (b.form != null) {
    const form = new URLSearchParams(b.form);
    form.delete("propertyID");
    if (propertyId) form.set("propertyID", propertyId);
    body = form.toString();
  } else if (propertyId && method === "GET") {
    url.searchParams.set("propertyID", propertyId);
  }
  try {
    const res = await fetch(url, {
      method,
      headers: { "x-api-key": apiKey, ...(body !== undefined ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const isi = await res.json().catch(() => null);
    return NextResponse.json({ status: res.status, body: isi });
  } catch (e) {
    return NextResponse.json({ error: `Cloudbeds tidak bisa dihubungi: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
