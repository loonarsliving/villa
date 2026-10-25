import "server-only";

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "./format";
import { kirimDariNomorUtama } from "./mkhsistemWa";
import { secretsMatch } from "./internalSecret";
import {
  hitungRingkasan,
  jumlahPerUnit,
  kelompokkanPenerima,
  teksPengantar,
  type InvestorAkun,
  type IsiBukti,
  type LaporanBulan,
  type PenerimaBukti,
  type RingkasanVilla,
} from "./buktiTransferData";

/**
 * I/O untuk mesin bukti transfer (lihat buktiTransferData.ts untuk aturan
 * angkanya). Angka villa diambil dari computeReport villa-api lewat
 * /bridge/owner-finance -- rumus yang sama dengan laporan investor dan
 * asisten WA owner, tidak disalin ke sini.
 *
 * Gambar bukti dibuat saat diminta oleh /api/bukti-transfer/[d]/[s]/[file] dari isi
 * yang ditandatangani di URL-nya (HMAC dengan CRON_SECRET), jadi tidak ada
 * file yang disimpan dan tidak ada tabel baru: WhaCenter cukup mengunduh URL
 * itu. Tanda tangan mencegah orang membuat bukti palsu atas nama villa.
 */

const VILLA_API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";
export const TEMPLATE_BUKTI = "dividend_receipt";
/** Cukup lama untuk WhaCenter mengunduh dan investor membuka ulang dari WA. */
const MASA_BERLAKU_DETIK = 30 * 86400;

export interface DaftarBukti {
  periode: string;
  tanggal: string;
  hari: number;
  per_unit: number;
  ringkasan: RingkasanVilla;
  penerima: (PenerimaBukti & { sudah_dikirim_at: string | null })[];
}

async function ambilLaporan(supabase: SupabaseClient, periode: string): Promise<LaporanBulan> {
  const { data } = await supabase.from("integration_settings").select("value").eq("key", "vercel_bridge").maybeSingle();
  const secret = String((data?.value as { secret?: string } | undefined)?.secret ?? "").trim();
  if (!secret) throw new Error("integration_settings.vercel_bridge.secret belum diisi");
  const res = await fetch(`${VILLA_API_BASE}/bridge/owner-finance?bulan=${periode}`, {
    headers: { "x-internal-secret": secret },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const json = (await res.json().catch(() => null)) as { laporan_investor?: LaporanBulan; error?: string } | null;
  if (!res.ok || !json?.laporan_investor) throw new Error(`villa-api menjawab ${res.status}: ${json?.error ?? "tanpa laporan"}`);
  return json.laporan_investor;
}

async function ambilAkunInvestor(supabase: SupabaseClient, periode: string): Promise<InvestorAkun[]> {
  const awal = `${periode}-01`;
  const [{ data: akun, error }, { data: kepemilikan }, { data: terms }] = await Promise.all([
    supabase
      .from("villa_users")
      .select("id,nama,hp,unit_nomor,bank_nama,no_rekening,nama_pemilik_rekening")
      .eq("role", "owner")
      .eq("is_active", true)
      .order("unit_nomor"),
    supabase.from("villa_investor_units").select("user_id,unit_nomor"),
    supabase.from("villa_investor_terms").select("user_id,pemasukan_tetap").lte("mulai", awal).gte("selesai", awal),
  ]);
  if (error) throw new Error(`gagal membaca investor: ${error.message}`);
  const units = new Map<string, string[]>();
  for (const r of kepemilikan ?? []) {
    const k = String(r.user_id);
    units.set(k, [...(units.get(k) ?? []), String(r.unit_nomor)]);
  }
  const tetap = new Map((terms ?? []).map((t) => [String(t.user_id), Number(t.pemasukan_tetap)]));
  return (akun ?? []).map((a) => ({
    ...a,
    units: (units.get(String(a.id)) ?? []).sort(),
    pemasukan_tetap: tetap.get(String(a.id)) ?? null,
  }));
}

export async function susunDaftarBukti(supabase: SupabaseClient, now = new Date()): Promise<DaftarBukti> {
  const tanggal = todayISO(now);
  const periode = tanggal.slice(0, 7);
  const [laporan, akun] = await Promise.all([ambilLaporan(supabase, periode), ambilAkunInvestor(supabase, periode)]);
  const per_unit = jumlahPerUnit(laporan);
  const penerima = kelompokkanPenerima(akun, per_unit);

  const { data: log } = await supabase
    .from("wa_messages_log")
    .select("phone,created_at")
    .eq("template_type", TEMPLATE_BUKTI)
    .eq("status", "sent")
    .gte("created_at", `${periode}-01T00:00:00+07:00`)
    .order("created_at", { ascending: false });
  const terkirim = new Map<string, string>();
  for (const r of log ?? []) if (!terkirim.has(String(r.phone))) terkirim.set(String(r.phone), String(r.created_at));

  return {
    periode,
    tanggal,
    hari: Number(tanggal.slice(8, 10)),
    per_unit,
    ringkasan: hitungRingkasan(laporan),
    penerima: penerima.map((p) => ({ ...p, sudah_dikirim_at: terkirim.get(p.kunci) ?? null })),
  };
}

export function isiBuktiUntuk(d: DaftarBukti, p: PenerimaBukti, now = new Date()): IsiBukti {
  return {
    v: 1,
    nama: p.nama.toUpperCase(),
    bank: p.bank,
    rek4: p.rek4,
    units: p.units,
    jumlah: p.jumlah,
    tetap: p.pemasukan_tetap,
    per_unit: d.per_unit,
    periode: d.periode,
    tgl: d.tanggal,
    hari: d.hari,
    r: d.ringkasan,
    exp: Math.floor(now.getTime() / 1000) + MASA_BERLAKU_DETIK,
  };
}

function kunciTanda(): string {
  const s = (process.env.CRON_SECRET || "").trim();
  if (!s) throw new Error("CRON_SECRET belum diisi");
  return s;
}

function tanda(data: string): string {
  return createHmac("sha256", kunciTanda()).update(`bukti-transfer:${data}`).digest("base64url");
}

export function urlGambar(origin: string, isi: IsiBukti): string {
  const d = Buffer.from(JSON.stringify(isi)).toString("base64url");
  const file = `Bukti_Transfer_Loonars_${isi.periode}_${isi.units.join("-") || "TETAP"}.png`;
  return `${origin}/api/bukti-transfer/${d}/${tanda(d)}/${file}`;
}

/** null kalau tanda tangan salah atau sudah kedaluwarsa. */
export function bacaIsiBukti(d: string, s: string, now = new Date()): IsiBukti | null {
  if (!d || !s || !secretsMatch(s, tanda(d))) return null;
  try {
    const isi = JSON.parse(Buffer.from(d, "base64url").toString("utf8")) as IsiBukti;
    if (isi.v !== 1 || isi.exp < Math.floor(now.getTime() / 1000)) return null;
    return isi;
  } catch {
    return null;
  }
}

export interface HasilKirim {
  kunci: string;
  nama: string;
  ok: boolean;
  error?: string;
}

/**
 * Kirim satu per satu (bukan paralel) dan catat setiap hasil ke
 * wa_messages_log. Tanpa percobaan ulang otomatis, sama seperti
 * kirimDariNomorUtama: jawaban yang hilang di jalan bisa berarti pesan sudah
 * sampai, dan mengulang = bukti dobel ke investor.
 */
export async function kirimBukti(
  supabase: SupabaseClient,
  d: DaftarBukti,
  kunci: string[],
  origin: string,
): Promise<HasilKirim[]> {
  const pilihan = d.penerima.filter((p) => kunci.includes(p.kunci));
  const hasil: HasilKirim[] = [];
  for (const p of pilihan) {
    const url = urlGambar(origin, isiBuktiUntuk(d, p));
    const pesan = teksPengantar(p.nama, d.periode);
    const kirim = await kirimDariNomorUtama(p.hp, pesan, url);
    const { error: eLog } = await supabase.from("wa_messages_log").insert({
      phone: p.kunci,
      message: pesan,
      template_type: TEMPLATE_BUKTI,
      status: kirim.success ? "sent" : "failed",
      response: { jumlah: p.jumlah, units: p.units, periode: d.periode, ...(kirim.success ? {} : { error: kirim.error }) },
    });
    if (eLog) console.error("[buktiTransfer] gagal mencatat log WA", eLog.message);
    hasil.push({ kunci: p.kunci, nama: p.nama, ok: kirim.success, error: kirim.error });
  }
  return hasil;
}
