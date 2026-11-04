import { NextResponse } from "next/server";

import { getCloudbedsRatePlans, getCloudbedsRoomBlocks, getCloudbedsRooms, parseRoomsAvailableByRoomType, type CloudbedsAkun } from "@/lib/cloudbedsApi";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Diagnosa (hanya baca): menurut Cloudbeds, berapa kamar per tipe yang
 * DIBUKA untuk dijual per tanggal, dan blokir kamar apa saja yang berlaku.
 * OTA (Agoda dll) hanya menjual yang dibuka Cloudbeds. Owner 2026-11-04:
 * "cek knpa agoda masi membuka kamar sy". ?akun=el|utama&hari=60
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const akunParam = (url.searchParams.get("akun") ?? "utama").trim().toLowerCase();
  let akun: CloudbedsAkun = "utama";
  const hari = Math.min(120, Math.max(7, Number(url.searchParams.get("hari") ?? 60) || 60));
  if (akunParam !== "utama") akun = (await siapkanAkunCloudbeds(akunParam)).akun;
  const mulai = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const tambah = (n: number) => new Date(Date.parse(`${mulai}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  try {
    const [rooms, plans] = await Promise.all([getCloudbedsRooms(akun), getCloudbedsRatePlans(mulai, tambah(hari), akun)]);
    const tersedia = parseRoomsAvailableByRoomType(plans);
    const namaTipe = new Map(rooms.map((r) => [String(r.roomTypeID), r.roomTypeName ?? "?"]));
    const perTipe: Record<string, { tanggal_terbuka: number; terbuka_pertama: string | null; contoh: Record<string, number> }> = {};
    for (const [tipe, perTgl] of tersedia) {
      const terbuka = [...perTgl].filter(([, n]) => n > 0).sort();
      perTipe[namaTipe.get(tipe) ?? tipe] = {
        tanggal_terbuka: terbuka.length,
        terbuka_pertama: terbuka[0]?.[0] ?? null,
        contoh: Object.fromEntries([...perTgl].sort().slice(0, 21)),
      };
    }
    const blok: unknown[] = [];
    for (let i = 0; i < hari; i += 34) {
      try {
        const data = await getCloudbedsRoomBlocks(tambah(i), tambah(Math.min(hari, i + 34)), akun);
        for (const w of data) {
          for (const b of ((w as { roomBlocks?: unknown[] }).roomBlocks ?? []) as Record<string, unknown>[]) {
            blok.push({ nama: b.roomBlockName ?? b.roomBlockReason ?? null, tipe: b.roomBlockType ?? null, mulai: b.startDate, selesai: b.endDate, kamar: ((b.rooms ?? []) as { roomName?: string; roomID?: string }[]).map((r) => r.roomName ?? r.roomID) });
          }
        }
      } catch (e) {
        blok.push({ error: e instanceof Error ? e.message : String(e) });
      }
    }
    return NextResponse.json({
      akun,
      dari: mulai,
      sampai: tambah(hari),
      room: rooms.map((r) => ({ nama: r.roomName, tipe: r.roomTypeName, diblokir_hari_ini: r.roomBlocked })),
      ketersediaan_per_tipe: perTipe,
      blokir: blok,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
