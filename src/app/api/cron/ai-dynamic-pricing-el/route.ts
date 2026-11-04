import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runDynamicPricingProperti } from "@/lib/elDynamicPricing";
import { daftarPropertiCloudbeds } from "@/lib/propertiConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dynamic pricing semua properti selain PL tiap malam (pg_cron
 * `villa-ai-dynamic-pricing-el`, nama lama dipertahankan). Kirim ke Cloudbeds
 * hanya bila saklar auto-push properti itu menyala (bawaan mati; batas
 * bawah/atas wajib diisi). Properti baru ikut otomatis begitu kunci
 * Cloudbeds-nya diisi. Jawaban: hasil EL di tingkat atas (kompatibel) +
 * `properti` per kode. Lihat src/lib/elDynamicPricing.ts.
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
      properti[p.kode] = await runDynamicPricingProperti(p.kode);
    } catch (e) {
      galat++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron/ai-dynamic-pricing] ${p.kode} gagal`, message);
      properti[p.kode] = { error: message };
    }
  }
  const el = properti["EL"];
  return NextResponse.json({ ...(el && typeof el === "object" ? (el as object) : {}), properti }, { status: daftar.length > 0 && galat === daftar.length ? 502 : 200 });
}
