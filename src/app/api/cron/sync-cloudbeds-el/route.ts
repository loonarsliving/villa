import { NextResponse } from "next/server";

import { CloudbedsApiError } from "@/lib/cloudbedsApi";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { KunciElDitolak, syncCloudbedsProperti } from "@/lib/elCloudbedsSync";
import { daftarPropertiCloudbeds } from "@/lib/propertiConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sinkron Cloudbeds SEMUA properti selain Private Living tiap 10 menit
 * (pg_cron `villa-sync-cloudbeds-el`, nama lama dipertahankan), padanan
 * /api/cron/sync-cloudbeds-reservations Private Living: tarik reservasi +
 * kirim booking front desk/website. Properti baru otomatis ikut begitu
 * kunci Cloudbeds-nya diisi admin (tanpa coding). Satu properti gagal tidak
 * menghentikan yang lain. Jawaban: ringkasan EL di tingkat atas (kompatibel
 * dengan pemeriksaan lama) + `properti` = ringkasan per kode.
 * Lihat src/lib/elCloudbedsSync.ts.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const daftar = await daftarPropertiCloudbeds();
  const properti: Record<string, unknown> = {};
  let galat = 0;
  for (const p of daftar) {
    try {
      properti[p.kode] = await syncCloudbedsProperti(p.kode);
    } catch (e) {
      galat++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron/sync-cloudbeds] ${p.kode} gagal`, message);
      properti[p.kode] = { error: message, ...(e instanceof KunciElDitolak ? { kunci: e.periksa } : {}), status: e instanceof CloudbedsApiError ? e.status : 502 };
    }
  }
  const el = properti["EL"];
  return NextResponse.json({ ...(el && typeof el === "object" ? (el as object) : {}), properti }, { status: daftar.length > 0 && galat === daftar.length ? 502 : 200 });
}
