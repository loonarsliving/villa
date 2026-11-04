import "server-only";

import {
  CloudbedsApiError,
  daftarkanAkunCloudbeds,
  jenisKunci,
  periksaKunciEl,
  type CloudbedsAkun,
  type HasilPeriksaKunci,
} from "@/lib/cloudbedsApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Pengaturan per properti (owner 2026-11-04: "kt tidak perlu coding lg untuk
 * tambah property, saya tinggal memasukkan api cloudbeds, email dan
 * password"). Semuanya di integration_settings, kunci memakai kode properti
 * huruf kecil:
 *   properti_<kode>        -- Cloudbeds (api key, property id), siap, cabang MK Connect
 *   payment_email_<kode>   -- kotak email notifikasi BTN (host, port, user, password)
 *   <kode>_qris            -- gambar QRIS properti
 *   <kode>_dynamic_pricing -- harga dasar, autopush, harga online
 * PL memakai env/kunci lamanya; EL boleh tetap memakai env (CLOUDBEDS_*_LOONARS2)
 * kalau properti_el belum berisi kunci.
 */
export interface KonfigProperti {
  cloudbeds_api_key?: string;
  cloudbeds_property_id?: string;
  /** Sudah diaktifkan admin (kamar dibuka untuk fitur operasional di villa-api). */
  siap?: boolean;
  /** Nama cabang di MK Connect (daftar security); bawaan: nama properti. */
  cabang_mkconnect?: string[];
}

export const kunciKonfigProperti = (kode: string) => `properti_${kode.trim().toLowerCase()}`;

export async function bacaKonfigProperti(kode: string): Promise<KonfigProperti> {
  const { data } = await supabaseAdmin().from("integration_settings").select("value").eq("key", kunciKonfigProperti(kode)).maybeSingle();
  return (data?.value ?? {}) as KonfigProperti;
}

/** Gabungkan perubahan ke pengaturan properti (tidak menghapus kolom lain). */
export async function simpanKonfigProperti(kode: string, perubahan: Partial<KonfigProperti>, oleh = "admin"): Promise<KonfigProperti> {
  const lama = await bacaKonfigProperti(kode);
  const baru = { ...lama, ...perubahan } as KonfigProperti;
  const { error } = await supabaseAdmin()
    .from("integration_settings")
    .upsert({ key: kunciKonfigProperti(kode), value: baru, updated_at: new Date().toISOString(), updated_by: oleh }, { onConflict: "key" });
  if (error) throw new Error(`pengaturan properti ${kode} gagal disimpan: ${error.message}`);
  return baru;
}

const CLOUDBEDS_API_BASE = "https://api.cloudbeds.com/api/v1.2";

export interface HasilTesKunci {
  ok: boolean;
  status: number | null;
  pesan: string | null;
  jenis: ReturnType<typeof jenisKunci>;
  properti: { id: string; nama: string }[];
}

/** Tes satu kunci Cloudbeds ke getHotels (tanpa mencatat/mengembalikan isi kunci). */
export async function tesKunciCloudbeds(kunci: string): Promise<HasilTesKunci> {
  const k = kunci.trim();
  const jenis = jenisKunci(k);
  if (!k) return { ok: false, status: null, pesan: "Kunci API kosong", jenis, properti: [] };
  try {
    const res = await fetch(`${CLOUDBEDS_API_BASE}/getHotels`, { headers: { "x-api-key": k }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => null);
    const ok = res.ok && body?.success !== false;
    const rows = Array.isArray(body?.data) ? (body.data as Array<Record<string, unknown>>) : [];
    return {
      ok,
      status: res.status,
      pesan: ok ? null : String(body?.message ?? body?.error ?? "Cloudbeds menolak kunci ini").slice(0, 200),
      jenis,
      properti: rows.map((r) => ({ id: String(r.propertyID ?? ""), nama: String(r.propertyName ?? "") })).slice(0, 10),
    };
  } catch (e) {
    return { ok: false, status: null, pesan: `Cloudbeds tidak bisa dihubungi: ${e instanceof Error ? e.message : String(e)}`, jenis, properti: [] };
  }
}

/**
 * Siapkan akun Cloudbeds satu properti dan kembalikan namanya untuk fungsi
 * cloudbedsApi. PL -> "utama" (env); EL tanpa kunci di database -> kunci env
 * lama (diperiksa seperti dulu); selain itu kunci dari properti_<kode>.
 * Melempar CloudbedsApiError bila kunci belum diisi / ditolak.
 */
export async function siapkanAkunCloudbeds(kode: string): Promise<{ akun: CloudbedsAkun; periksa: { terpilih: string | null; hasil: HasilPeriksaKunci[] } }> {
  const K = kode.trim().toUpperCase();
  if (K === "PL") return { akun: "utama", periksa: { terpilih: "CLOUDBEDS_API_KEY", hasil: [] } };
  const akun = K.toLowerCase();
  const konfig = await bacaKonfigProperti(K);
  if (konfig.cloudbeds_api_key) {
    daftarkanAkunCloudbeds(akun, { apiKey: konfig.cloudbeds_api_key, propertyId: konfig.cloudbeds_property_id ?? "" });
    const t = await tesKunciCloudbeds(konfig.cloudbeds_api_key);
    if (!t.ok) throw new CloudbedsApiError(`Cloudbeds menolak kunci properti ${K}: ${t.pesan ?? "ditolak"}`, 401);
    return {
      akun,
      periksa: {
        terpilih: `properti_${akun}`,
        hasil: [{ env: `properti_${akun}`, panjang: konfig.cloudbeds_api_key.length, jenis: t.jenis, http_x_api_key: t.status, http_bearer: null, pesan: null, properti: t.properti }],
      },
    };
  }
  if (K === "EL") {
    const periksa = await periksaKunciEl();
    if (!periksa.terpilih) throw new CloudbedsApiError(periksa.hasil.length ? "Cloudbeds menolak semua kunci Excellent Living" : "Kunci Cloudbeds Excellent Living belum diisi", periksa.hasil.length ? 401 : 503);
    return { akun: "el", periksa };
  }
  throw new CloudbedsApiError(`Kunci Cloudbeds properti ${K} belum diisi`, 503);
}

export interface PropertiAktif {
  kode: string;
  nama: string;
}

/**
 * Properti selain PL yang aktif dan punya Cloudbeds (kunci di database, atau
 * EL dengan env lama). Dipakai cron sinkron & harga yang berjalan untuk
 * semua properti sekaligus.
 */
export async function daftarPropertiCloudbeds(): Promise<PropertiAktif[]> {
  const { data } = await supabaseAdmin().from("villa_properties").select("kode, nama, aktif").eq("aktif", true);
  const hasil: PropertiAktif[] = [];
  for (const p of data ?? []) {
    const kode = String(p.kode);
    if (kode === "PL") continue;
    const konfig = await bacaKonfigProperti(kode);
    const adaEnvEl = kode === "EL" && !!(process.env.CLOUDBEDS2_API_KEY || process.env.CLOUDBEDS_API_KEY_LOONARS2 || process.env.CLOUDBEDS_SECRET_LOONARS2);
    if (konfig.cloudbeds_api_key || adaEnvEl) hasil.push({ kode, nama: String(p.nama) });
  }
  return hasil;
}
