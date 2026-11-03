import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCloudbedsRoomTypeRate, getCloudbedsRooms } from "@/lib/cloudbedsApi";

/**
 * Harga Excellent Living DIBACA dari Cloudbeds (owner 2026-11-03: "harga
 * sinkronkan juga diambil dari cloudbeds"). Sama seperti Private Living,
 * Cloudbeds = sumber harga yang juga dikirim ke semua OTA. Modul ini hanya
 * membaca (`getRate`); tidak ada harga yang ditulis ke Cloudbeds dan tidak
 * ada mesin harga AI untuk EL.
 *
 * Kaitan tipe: kamar EL -> el_cloudbeds_room_mapping -> room Cloudbeds ->
 * roomTypeID (getRooms akun EL).
 */

export interface HargaTipe {
  room_type_id: string;
  kode: string;
  nama: string;
  cloudbeds_room_type_id: string | null;
  per_malam: { date: string; rate: number | null }[];
  /** Total menginap; null bila ada malam tanpa harga di Cloudbeds. */
  total: number | null;
}

function tanggalAntara(dari: string, sampai: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${dari}T00:00:00Z`); t < Date.parse(`${sampai}T00:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Harga per malam [checkin, checkout) per tipe kamar EL aktif, plus tipe tiap kamar. */
export async function hargaElDariCloudbeds(
  supabase: SupabaseClient,
  checkin: string,
  checkout: string,
): Promise<{ tipe: HargaTipe[]; tipeKamar: Record<string, string> }> {
  const malam = tanggalAntara(checkin, checkout);
  const [roomsCb, { data: peta }, { data: kamar }, { data: tipe }] = await Promise.all([
    getCloudbedsRooms("el"),
    supabase.from("el_cloudbeds_room_mapping").select("cloudbeds_room_id, room_id"),
    supabase.from("el_rooms").select("id, room_type_id").eq("active", true),
    supabase.from("el_room_types").select("id, kode, nama, sort_order").eq("active", true).order("sort_order"),
  ]);
  const tipeCbDariRoom = new Map(roomsCb.map((r) => [r.roomID, r.roomTypeID ?? null]));
  const tipeLokalDariKamar = new Map((kamar ?? []).map((k) => [String(k.id), String(k.room_type_id)]));
  // tipe lokal -> roomTypeID Cloudbeds (dari kamar pertama yang dipetakan)
  const tipeCb = new Map<string, string>();
  for (const p of peta ?? []) {
    const lokal = tipeLokalDariKamar.get(String(p.room_id));
    const cb = tipeCbDariRoom.get(String(p.cloudbeds_room_id));
    if (lokal && cb && !tipeCb.has(lokal)) tipeCb.set(lokal, cb);
  }

  const hasil: HargaTipe[] = [];
  for (const t of tipe ?? []) {
    const cbId = tipeCb.get(String(t.id)) ?? null;
    let rates = new Map<string, number>();
    if (cbId && malam.length) {
      const r = await getCloudbedsRoomTypeRate(cbId, malam[0], malam[malam.length - 1], "el");
      rates = new Map(r.map((x) => [x.date.slice(0, 10), x.rate]));
    }
    const per_malam = malam.map((d) => ({ date: d, rate: rates.get(d) ?? null }));
    const lengkap = per_malam.length > 0 && per_malam.every((x) => x.rate !== null);
    hasil.push({
      room_type_id: String(t.id),
      kode: String(t.kode),
      nama: String(t.nama),
      cloudbeds_room_type_id: cbId,
      per_malam,
      total: lengkap ? per_malam.reduce((s, x) => s + (x.rate ?? 0), 0) : null,
    });
  }
  return { tipe: hasil, tipeKamar: Object.fromEntries(tipeLokalDariKamar) };
}
