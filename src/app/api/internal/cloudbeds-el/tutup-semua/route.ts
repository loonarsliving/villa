import { NextResponse } from "next/server";

import { getCloudbedsRooms, kredensialCloudbeds } from "@/lib/cloudbedsApi";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";

/**
 * Tutup SEMUA kamar Cloudbeds Excellent Living yang belum tertutup (owner
 * 2026-11-04: "Tolong tutup kembali smua"). Setelah owner menambah kamar
 * di Cloudbeds EL, blokir "under maintenance" s/d 2027-01-01 hanya menutup 4
 * kamar lama; kamar baru terbuka dan bisa dijual OTA.
 *
 * Satu room block out_of_service baru, mulai hari ini (WIB) sampai `sampai`
 * (endDate Cloudbeds EKSKLUSIF = hari kamar dibuka lagi), untuk kamar yang
 * pada hari ini tidak tercakup blokir yang berlaku sampai `sampai`. Blokir
 * yang sudah ada tidak diubah. Tanpa `jalankan: true` hanya menampilkan
 * rencananya. Hanya rahasia cron (dipanggil admin lewat database).
 */
function hariIniWib(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

interface BlokCb {
  roomBlockID?: string;
  startDate?: string;
  endDate?: string;
  rooms?: { roomID?: string }[];
}

async function cb(apiKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${CLOUDBEDS_API_BASE}/${path}`, { ...init, headers: { "x-api-key": apiKey, ...(init?.headers ?? {}) }, cache: "no-store", signal: AbortSignal.timeout(20000) });
  return { status: res.status, body: (await res.json().catch(() => null)) as { success?: boolean; message?: string; roomBlockID?: string; data?: { roomBlocks?: BlokCb[] } | { roomBlocks?: BlokCb[] }[] } | null };
}

function daftarBlok(body: Awaited<ReturnType<typeof cb>>["body"]): BlokCb[] {
  const wadah = Array.isArray(body?.data) ? body.data : [body?.data];
  return wadah.flatMap((w) => w?.roomBlocks ?? []);
}

export async function POST(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { sampai?: string; alasan?: string; jalankan?: boolean; properti?: string };
  const kode = String(b.properti ?? "EL").trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(kode) || kode === "PL") return NextResponse.json({ error: "properti tidak valid" }, { status: 400 });
  const mulai = hariIniWib();
  const sampai = String(b.sampai ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sampai) || sampai <= mulai) return NextResponse.json({ error: "sampai (YYYY-MM-DD, hari kamar dibuka lagi) wajib dan harus setelah hari ini" }, { status: 400 });
  const alasan = String(b.alasan ?? "under maintenance").slice(0, 250);

  const { akun } = await siapkanAkunCloudbeds(kode);
  const { apiKey, propertyId } = kredensialCloudbeds(akun);
  const rooms = (await getCloudbedsRooms(akun)).filter((r) => !r.isVirtual && r.roomTypeID);

  const q = new URLSearchParams({ propertyID: propertyId, startDate: mulai, endDate: mulai, pageSize: "100" });
  const baca = await cb(apiKey, `getRoomBlocks?${q}`);
  if (baca.status !== 200 || baca.body?.success === false) return NextResponse.json({ error: "getRoomBlocks gagal", jawaban: baca.body }, { status: 502 });
  // Kamar yang sudah tertutup sampai tanggal tujuan (atau lebih lama).
  const tertutup = new Set<string>();
  for (const k of daftarBlok(baca.body)) {
    if ((k.startDate ?? "9999") <= mulai && (k.endDate ?? "") >= sampai) for (const r of k.rooms ?? []) if (r.roomID) tertutup.add(String(r.roomID));
  }
  const target = rooms.filter((r) => !tertutup.has(r.roomID));
  const rencana = { mulai, sampai_dibuka_lagi: sampai, sudah_tertutup: rooms.filter((r) => tertutup.has(r.roomID)).map((r) => r.roomName), akan_ditutup: target.map((r) => r.roomName) };
  if (!b.jalankan || target.length === 0) return NextResponse.json({ dijalankan: false, ...rencana });

  const form = new URLSearchParams({ propertyID: propertyId, roomBlockType: "out_of_service", roomBlockReason: alasan, startDate: mulai, endDate: sampai });
  target.forEach((r, i) => {
    form.set(`rooms[${i}][roomID]`, r.roomID);
    form.set(`rooms[${i}][roomTypeID]`, String(r.roomTypeID));
  });
  const buat = await cb(apiKey, "postRoomBlock", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const id = buat.body?.roomBlockID ? String(buat.body.roomBlockID) : null;
  // Baca balik: blok dianggap ada kalau benar-benar terbaca di Cloudbeds.
  let terbaca: BlokCb | null = null;
  if (id) {
    const cek = await cb(apiKey, `getRoomBlocks?${new URLSearchParams({ propertyID: propertyId, startDate: mulai, endDate: mulai, pageSize: "100" })}`);
    terbaca = daftarBlok(cek.body).find((k) => String(k.roomBlockID) === id) ?? null;
  }
  const kamarTerbaca = new Set((terbaca?.rooms ?? []).map((r) => String(r.roomID)));
  return NextResponse.json(
    {
      dijalankan: true,
      ...rencana,
      berhasil: !!terbaca,
      roomBlockID: id,
      blok_terbaca: terbaca ? { startDate: terbaca.startDate, endDate: terbaca.endDate, jumlah_kamar: kamarTerbaca.size } : null,
      belum_tertutup: target.filter((r) => !kamarTerbaca.has(r.roomID)).map((r) => r.roomName),
      jawaban_cloudbeds: buat.body,
    },
    { status: terbaca ? 200 : 502 },
  );
}
