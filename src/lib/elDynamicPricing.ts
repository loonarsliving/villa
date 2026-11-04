import "server-only";

import {
  collapseRateIntervals,
  getCloudbedsBaseRateId,
  getCloudbedsRoomTypeRate,
  getCloudbedsRooms,
  pushCloudbedsRate,
} from "@/lib/cloudbedsApi";
import { siapkanAkunCloudbeds } from "@/lib/propertiConfig";
import { decideRatesForRoomType, type PricingSettings, type RoomTypeForPricing } from "@/lib/aiPricingEngine";
import { supabaseAdminProperti } from "@/lib/supabaseAdmin";

/**
 * Dynamic pricing Loonars Excellent Living (owner 2026-11-04: "Harga
 * dasarnya ambil dcloudbeds ... ya bawa dynamic pricing dsni", lalu "Auto
 * push pun tidak masalah jaga sj batas bawah dan batas atasnya").
 *
 * Mesin yang sama dengan Private Living (decideRatesForRoomType: okupansi,
 * pace, high season Jogja, permintaan pasar, sisa kamar), dengan aturan EL:
 *
 *  1. HARGA DASAR = SNAPSHOT harga Cloudbeds EL, diambil SEKALI dan disimpan
 *     (integration_settings 'el_dynamic_pricing'.harga_dasar: per tipe, per
 *     hari dalam minggu). Mesin TIDAK PERNAH membaca harga Cloudbeds hari
 *     ini sebagai dasar -- harga itu ditulis mesin ini sendiri saat
 *     auto-push, dan memakainya sebagai dasar membuat harga naik bertumpuk
 *     tiap malam (bug Private Living 2026-09-11, lihat aiDynamicPricingRun).
 *     Pola akhir pekan sudah ada di snapshot, jadi tambahan akhir pekan
 *     khusus PL tidak dipakai (anchorPerTanggal).
 *  2. BATAS BAWAH/ATAS per tipe = villa_room_types.min_rate / max_rate
 *     properti EL. Tanpa batas lengkap, tipe itu tidak dihitung/dikirim.
 *  3. AUTO-PUSH = 'el_dynamic_pricing'.autopush (terpisah dari saklar PL),
 *     bawaan false. Hanya bila true harga dikirim ke Cloudbeds EL.
 *  4. Riset harga pesaing TIDAK dipakai untuk EL sampai alamat EL diisi
 *     (riset memakai alamat Private Living di Sleman).
 */

export const KUNCI_SETELAN_EL = "el_dynamic_pricing";
/** Kunci setelan harga properti mana pun: "<kode>_dynamic_pricing" (EL = KUNCI_SETELAN_EL). */
export const kunciSetelanHarga = (kode: string) => `${kode.trim().toLowerCase()}_dynamic_pricing`;
const HARI = ["min", "sen", "sel", "rab", "kam", "jum", "sab"] as const;
type Hari = (typeof HARI)[number];
const WINDOW_DAYS = 365;
const TAMPIL_DAYS = 31;

export interface SetelanHargaEl {
  autopush: boolean;
  /** kode tipe -> harga Cloudbeds per hari dalam minggu saat snapshot diambil. */
  harga_dasar: Record<string, Partial<Record<Hari, number>>>;
  harga_dasar_diambil: string | null;
  terakhir_jalan?: string;
  /** Rekomendasi 31 hari dari run terakhir, untuk halaman Harga EL. */
  rekomendasi?: Record<string, { date: string; rate: number; alasan: string; guardrail: string }[]>;
  hasil_terakhir?: unknown;
  /**
   * Harga per malam yang sama dengan yang dikirim ke Cloudbeds, 365 hari,
   * untuk booking online di loonars.id (kode tipe -> tanggal -> rupiah).
   * Dihitung dari mesin yang sama, sudah dijepit batas bawah/atas.
   */
  harga_online?: Record<string, Record<string, number>>;
}

function tambahHari(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function hariIniWib(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}
function hariDari(iso: string): Hari {
  return HARI[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

/** Pola harga per hari dalam minggu dari harga Cloudbeds 28 hari (modus per hari). */
export function polaHarian(rates: { date: string; rate: number }[]): Partial<Record<Hari, number>> {
  const per: Record<string, Map<number, number>> = {};
  for (const r of rates) {
    const h = hariDari(r.date.slice(0, 10));
    per[h] ??= new Map();
    per[h].set(r.rate, (per[h].get(r.rate) ?? 0) + 1);
  }
  const out: Partial<Record<Hari, number>> = {};
  for (const h of HARI) {
    const m = per[h];
    if (!m) continue;
    // Harga yang paling sering muncul untuk hari itu (tanggal khusus/libur tidak ikut jadi dasar).
    out[h] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  }
  return out;
}

export function bacaSetelanEl(): Promise<SetelanHargaEl> {
  return bacaSetelanHarga("EL");
}

export async function bacaSetelanHarga(kode: string): Promise<SetelanHargaEl> {
  const db = supabaseAdminProperti(kode);
  const { data } = await db.from("integration_settings").select("value").eq("key", kunciSetelanHarga(kode)).maybeSingle();
  const v = (data?.value ?? {}) as Partial<SetelanHargaEl>;
  return { autopush: v.autopush === true, harga_dasar: v.harga_dasar ?? {}, harga_dasar_diambil: v.harga_dasar_diambil ?? null, terakhir_jalan: v.terakhir_jalan, rekomendasi: v.rekomendasi, hasil_terakhir: v.hasil_terakhir, harga_online: v.harga_online };
}

async function simpanSetelanHarga(kode: string, s: SetelanHargaEl) {
  const db = supabaseAdminProperti(kode);
  const { error } = await db.from("integration_settings").upsert({ key: kunciSetelanHarga(kode), value: s }, { onConflict: "key" });
  if (error) throw new Error(`setelan harga ${kode} gagal disimpan: ${error.message}`);
}

export interface HasilTipeEl {
  kode: string;
  nama: string;
  min_rate: number | null;
  max_rate: number | null;
  dasar_hari_ini: number | null;
  rekomendasi_hari_ini: number | null;
  dikirim: boolean;
  error?: string;
}

/**
 * Jalankan dynamic pricing EL. `paksaKirim` hanya untuk uji manual admin
 * (false = tidak pernah kirim, true = kirim walau saklar mati, undefined =
 * ikut saklar).
 */
export function runElDynamicPricing(opsi: { paksaKirim?: boolean } = {}) {
  return runDynamicPricingProperti("EL", opsi);
}

/** Dynamic pricing untuk satu properti non-PL (aturan sama persis dengan EL, lihat komentar di atas). */
export async function runDynamicPricingProperti(kodeProperti: string, opsi: { paksaKirim?: boolean } = {}): Promise<{ autopush: boolean; dikirim: boolean; harga_dasar_baru: boolean; tipe: HasilTipeEl[] }> {
  const kode_ = kodeProperti.trim().toUpperCase();
  if (kode_ === "PL") throw new Error("Harga Private Living memakai mesin PL, bukan jalur ini");
  const { akun } = await siapkanAkunCloudbeds(kode_);
  const db = supabaseAdminProperti(kode_);
  const setelan = await bacaSetelanHarga(kode_);
  const kirim = opsi.paksaKirim ?? setelan.autopush;
  const hariIni = hariIniWib();
  const tanggal = Array.from({ length: WINDOW_DAYS }, (_, i) => tambahHari(hariIni, i));

  const { data: setRows } = await db.from("villa_pricing_settings").select("*").eq("active", true).limit(1);
  const st = setRows?.[0];
  if (!st) throw new Error("villa_pricing_settings aktif tidak ada");
  const pengaturan: PricingSettings = {
    max_daily_movement_pct: Number(st.max_daily_movement_pct),
    high_occupancy_threshold_pct: Number(st.high_occupancy_threshold_pct),
    high_occupancy_adjustment_pct: Number(st.high_occupancy_adjustment_pct),
    low_occupancy_threshold_pct: Number(st.low_occupancy_threshold_pct),
    low_occupancy_adjustment_pct: Number(st.low_occupancy_adjustment_pct),
  };

  const [roomsCb, { data: peta }, { data: units }, { data: tipe }] = await Promise.all([
    getCloudbedsRooms(akun),
    db.from("cloudbeds_room_mapping").select("cloudbeds_room_id, unit_id"),
    db.from("units").select("id, room_type_id"),
    db.from("villa_room_types").select("id, code, name, description, base_rate, min_rate, max_rate").eq("active", true),
  ]);
  const tipeCbDariRoom = new Map(roomsCb.map((r) => [r.roomID, r.roomTypeID ?? null]));
  const tipeDariUnit = new Map((units ?? []).map((u) => [String(u.id), String(u.room_type_id)]));
  const tipeCbDariTipe = new Map<string, string>();
  for (const p of peta ?? []) {
    const lokal = tipeDariUnit.get(String(p.unit_id));
    const cb = tipeCbDariRoom.get(String(p.cloudbeds_room_id));
    if (lokal && cb && !tipeCbDariTipe.has(lokal)) tipeCbDariTipe.set(lokal, cb);
  }

  let dasarBaru = false;
  const hasil: HasilTipeEl[] = [];
  const rekomendasi: NonNullable<SetelanHargaEl["rekomendasi"]> = {};
  const hargaOnline: NonNullable<SetelanHargaEl["harga_online"]> = {};
  let adaKirim = false;

  for (const t of tipe ?? []) {
    const kode = String(t.code);
    const cbId = tipeCbDariTipe.get(String(t.id)) ?? null;
    const r: HasilTipeEl = { kode, nama: String(t.name), min_rate: t.min_rate !== null ? Number(t.min_rate) : null, max_rate: t.max_rate !== null ? Number(t.max_rate) : null, dasar_hari_ini: null, rekomendasi_hari_ini: null, dikirim: false };
    hasil.push(r);
    if (!cbId) {
      r.error = "tipe belum terhubung ke Cloudbeds";
      continue;
    }
    // Snapshot harga dasar: sekali saja (atau bila belum ada untuk tipe ini).
    if (!setelan.harga_dasar[kode] || Object.keys(setelan.harga_dasar[kode]).length < 7) {
      const rates = await getCloudbedsRoomTypeRate(cbId, hariIni, tambahHari(hariIni, 28), akun);
      const pola = polaHarian(rates);
      if (Object.keys(pola).length < 7) {
        r.error = "harga Cloudbeds 4 minggu ke depan belum lengkap -- harga dasar belum bisa diambil";
        continue;
      }
      setelan.harga_dasar[kode] = pola;
      dasarBaru = true;
    }
    const pola = setelan.harga_dasar[kode];
    const minRate = r.min_rate;
    const maxRate = r.max_rate;
    if (!minRate || !maxRate || minRate > maxRate) {
      r.error = "batas bawah/atas belum diatur";
      continue;
    }
    const anchor = new Map(tanggal.map((d) => [d, Number(pola[hariDari(d)])]));
    const dasarMinggu = Math.min(...Object.values(pola).map(Number));
    const rt: RoomTypeForPricing = { id: String(t.id), code: kode, name: String(t.name), description: t.description ?? null, base_rate: dasarMinggu, min_rate: minRate, max_rate: maxRate };
    const keputusan = await decideRatesForRoomType(db, rt, dasarMinggu, tanggal, pengaturan, null, anchor);
    // Pengaman terakhir di luar mesin: tidak ada harga di luar batas yang lolos.
    const aman = keputusan.map((k) => ({ ...k, decided_rate: Math.min(maxRate, Math.max(minRate, Math.round(k.decided_rate))) }));
    r.dasar_hari_ini = anchor.get(hariIni) ?? null;
    r.rekomendasi_hari_ini = aman[0]?.decided_rate ?? null;
    hargaOnline[kode] = Object.fromEntries(aman.map((k) => [k.date, k.decided_rate]));
    rekomendasi[kode] = aman.slice(0, TAMPIL_DAYS).map((k) => ({ date: k.date, rate: k.decided_rate, alasan: k.reason_text, guardrail: k.guardrail_status }));

    if (!kirim) continue;
    try {
      const rateId = await getCloudbedsBaseRateId(cbId, hariIni, akun);
      if (!rateId) {
        r.error = "rate Cloudbeds tipe ini turunan/tidak tersedia -- tidak bisa dikirim";
        continue;
      }
      await pushCloudbedsRate(rateId, collapseRateIntervals(aman.map((k) => ({ date: k.date, rate: k.decided_rate }))), akun);
      r.dikirim = true;
      adaKirim = true;
    } catch (e) {
      r.error = `kirim ke Cloudbeds gagal: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (dasarBaru) setelan.harga_dasar_diambil = hariIni;
  setelan.terakhir_jalan = new Date().toISOString();
  setelan.rekomendasi = rekomendasi;
  // Tipe yang gagal dihitung kali ini tetap memakai harga terakhir yang ada.
  setelan.harga_online = { ...(setelan.harga_online ?? {}), ...hargaOnline };
  setelan.hasil_terakhir = hasil;
  await simpanSetelanHarga(kode_, setelan);
  return { autopush: setelan.autopush, dikirim: adaKirim, harga_dasar_baru: dasarBaru, tipe: hasil };
}
