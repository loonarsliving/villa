import { NextResponse } from "next/server";

import { CloudbedsApiError } from "@/lib/cloudbedsApi";
import { KunciElDitolak, syncCloudbedsProperti } from "@/lib/elCloudbedsSync";
import { isAdminToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tombol admin "Sinkron Sekarang" untuk satu properti non-PL (?properti=XX,
 * bawaan EL) -- jalur yang sama persis dengan cron. Untuk properti baru:
 * kamar dibuat otomatis dari room Cloudbeds bila properti belum punya kamar.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const kode = (new URL(request.url).searchParams.get("properti") ?? "EL").trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(kode) || kode === "PL") return NextResponse.json({ error: "properti tidak valid" }, { status: 400 });
  try {
    return NextResponse.json(await syncCloudbedsProperti(kode));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message, ...(e instanceof KunciElDitolak ? { kunci: e.periksa } : {}) }, { status: e instanceof CloudbedsApiError ? e.status : 502 });
  }
}
