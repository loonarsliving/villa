import { NextResponse } from "next/server";

import { daftarkanAkunCloudbeds, getCloudbedsRooms } from "@/lib/cloudbedsApi";
import { bacaKonfigProperti, simpanKonfigProperti, tesKunciCloudbeds } from "@/lib/propertiConfig";
import { supabaseAdmin, supabaseAdminProperti } from "@/lib/supabaseAdmin";
import { periksaTokenAdmin } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VILLA_API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

/**
 * Pengaturan satu properti untuk wizard "Tambah Properti" (owner 2026-11-04:
 * "saya tinggal memasukkan api cloudbeds, email dan password"). Semua isian
 * diuji dulu sebelum disimpan; rahasia (kunci Cloudbeds, password email)
 * hanya disimpan, TIDAK pernah dikembalikan.
 *   GET  ?kode=XX            -> status tiap langkah
 *   POST {kode, aksi, ...}   -> cloudbeds | email | qris | cabang | aktifkan | nonaktifkan
 */
async function sesiAdmin(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenAdmin(token) : "ditolak";
  if (sesi === "gagal-periksa") return { tolak: NextResponse.json({ error: "Sesi tidak bisa diperiksa, coba lagi" }, { status: 503 }), token };
  if (sesi !== "lolos") return { tolak: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), token };
  return { tolak: null, token };
}

async function propertiAda(kodeMentah: unknown) {
  const kode = String(kodeMentah ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(kode) || kode === "PL") return null;
  const { data } = await supabaseAdmin().from("villa_properties").select("kode, nama, aktif").eq("kode", kode).maybeSingle();
  return data ? { kode, nama: String(data.nama), aktif: data.aktif === true } : null;
}

async function ambilSetting(key: string) {
  const { data } = await supabaseAdmin().from("integration_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? null) as Record<string, unknown> | null;
}

export async function GET(request: Request) {
  const { tolak } = await sesiAdmin(request);
  if (tolak) return tolak;
  const p = await propertiAda(new URL(request.url).searchParams.get("kode"));
  if (!p) return NextResponse.json({ error: "Properti tidak ditemukan" }, { status: 404 });
  const kecil = p.kode.toLowerCase();
  const [konfig, email, qris, harga] = await Promise.all([
    bacaKonfigProperti(p.kode),
    ambilSetting(`payment_email_${kecil}`),
    ambilSetting(`${kecil}_qris`),
    ambilSetting(`${kecil}_dynamic_pricing`),
  ]);
  const db = supabaseAdminProperti(p.kode);
  const [{ data: tipe }, { data: kamar }] = await Promise.all([
    db.from("villa_room_types").select("id, code, name, min_rate, max_rate").eq("active", true).order("name"),
    db.from("units").select("id, room_type_id, status"),
  ]);
  const viaEnv = p.kode === "EL" && !konfig.cloudbeds_api_key && !!(process.env.CLOUDBEDS2_API_KEY || process.env.CLOUDBEDS_API_KEY_LOONARS2 || process.env.CLOUDBEDS_SECRET_LOONARS2);
  const tipeRingkas = (tipe ?? []).map((t) => ({
    code: String(t.code),
    name: String(t.name),
    jumlah: (kamar ?? []).filter((k) => k.room_type_id === t.id).length,
    min_rate: t.min_rate !== null ? Number(t.min_rate) : null,
    max_rate: t.max_rate !== null ? Number(t.max_rate) : null,
  }));
  return NextResponse.json({
    kode: p.kode,
    nama: p.nama,
    aktif: p.aktif,
    siap: p.kode === "EL" ? true : konfig.siap === true,
    cloudbeds: { terisi: !!konfig.cloudbeds_api_key || viaEnv, via_env: viaEnv, property_id: konfig.cloudbeds_property_id ?? null },
    kamar: { jumlah: (kamar ?? []).length, maintenance: (kamar ?? []).filter((k) => k.status === "maintenance").length },
    tipe: tipeRingkas,
    email: { terisi: !!(email && email.host && email.user && email.password), user: (email?.user as string | undefined) ?? null },
    qris: { terisi: !!(qris && qris.data_url) },
    harga: { autopush: (harga as { autopush?: boolean } | null)?.autopush === true, batas_lengkap: tipeRingkas.length > 0 && tipeRingkas.every((t) => t.min_rate && t.max_rate) },
    cabang_mkconnect: konfig.cabang_mkconnect ?? [],
  });
}

export async function POST(request: Request) {
  const { tolak, token } = await sesiAdmin(request);
  if (tolak) return tolak;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const p = await propertiAda(b.kode);
  if (!p) return NextResponse.json({ error: "Properti tidak ditemukan" }, { status: 404 });
  const kecil = p.kode.toLowerCase();

  try {
    if (b.aksi === "cloudbeds") {
      const kunci = String(b.api_key ?? "").trim();
      let propertyId = String(b.property_id ?? "").trim();
      const tes = await tesKunciCloudbeds(kunci);
      if (!tes.ok) return NextResponse.json({ error: tes.pesan ?? "Cloudbeds menolak kunci ini", jenis: tes.jenis }, { status: 400 });
      if (!propertyId && tes.properti.length === 1) propertyId = tes.properti[0].id;
      if (!propertyId && tes.properti.length > 1) {
        return NextResponse.json({ error: "Kunci ini melihat lebih dari satu properti Cloudbeds. Isi Property ID-nya.", properti: tes.properti }, { status: 409 });
      }
      daftarkanAkunCloudbeds(kecil, { apiKey: kunci, propertyId });
      const rooms = (await getCloudbedsRooms(kecil)).filter((r) => !r.isVirtual && r.roomTypeID);
      if (rooms.length === 0) return NextResponse.json({ error: "Kunci diterima, tetapi tidak ada kamar di akun Cloudbeds ini. Tambahkan kamar di Cloudbeds dulu." }, { status: 409 });
      await simpanKonfigProperti(p.kode, { cloudbeds_api_key: kunci, cloudbeds_property_id: propertyId }, "admin_wizard_properti");
      const tipe = new Map<string, number>();
      for (const r of rooms) tipe.set(r.roomTypeName ?? "?", (tipe.get(r.roomTypeName ?? "?") ?? 0) + 1);
      return NextResponse.json({
        ok: true,
        nama_hotel: tes.properti.find((h) => h.id === propertyId)?.nama ?? tes.properti[0]?.nama ?? null,
        jumlah_kamar: rooms.length,
        tipe: [...tipe].map(([nama, jumlah]) => ({ nama, jumlah })),
      });
    }

    if (b.aksi === "email") {
      const host = String(b.host ?? "").trim();
      const user = String(b.user ?? "").trim();
      const password = String(b.password ?? "");
      const port = Number(b.port ?? 993) || 993;
      const subject = String(b.subject_contains ?? "Payment Merchant Success").trim() || "Payment Merchant Success";
      if (!host || !user || !password) return NextResponse.json({ error: "Server IMAP, alamat email, dan password wajib diisi" }, { status: 400 });
      const res = await fetch(`${VILLA_API_BASE}/admin/tes-email`, {
        method: "POST",
        headers: { "x-villa-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ host, port, user, password, subject_contains: subject }),
        signal: AbortSignal.timeout(25000),
      });
      const tes = (await res.json().catch(() => null)) as { ok?: boolean; pesan?: string; notifikasi_belum_dibaca?: number; error?: string } | null;
      if (!res.ok || !tes?.ok) return NextResponse.json({ error: `Login email gagal: ${tes?.pesan ?? tes?.error ?? `HTTP ${res.status}`}` }, { status: 400 });
      const { error } = await supabaseAdmin()
        .from("integration_settings")
        .upsert({ key: `payment_email_${kecil}`, value: { host, port, user, password, secure: true, subject_contains: subject }, updated_at: new Date().toISOString(), updated_by: "admin_wizard_properti" }, { onConflict: "key" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, notifikasi_belum_dibaca: tes.notifikasi_belum_dibaca ?? 0 });
    }

    if (b.aksi === "qris") {
      const dataUrl = String(b.data_url ?? "");
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return NextResponse.json({ error: "Berkas QRIS harus gambar PNG/JPG/WebP" }, { status: 400 });
      if (dataUrl.length > 2_000_000) return NextResponse.json({ error: "Gambar QRIS terlalu besar (maks sekitar 1,4 MB)" }, { status: 400 });
      const { error } = await supabaseAdmin()
        .from("integration_settings")
        .upsert({ key: `${kecil}_qris`, value: { data_url: dataUrl }, updated_at: new Date().toISOString(), updated_by: "admin_wizard_properti" }, { onConflict: "key" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === "cabang") {
      const nama = Array.isArray(b.nama_cabang) ? b.nama_cabang.map((x) => String(x).trim()).filter(Boolean).slice(0, 5) : [];
      await simpanKonfigProperti(p.kode, { cabang_mkconnect: nama }, "admin_wizard_properti");
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === "aktifkan") {
      const konfig = await bacaKonfigProperti(p.kode);
      if (!konfig.cloudbeds_api_key && p.kode !== "EL") return NextResponse.json({ error: "Isi dan tes kunci Cloudbeds dulu" }, { status: 409 });
      const { count } = await supabaseAdminProperti(p.kode).from("units").select("id", { count: "exact", head: true });
      if ((count ?? 0) === 0) return NextResponse.json({ error: "Belum ada kamar. Jalankan Sinkron Kamar dari Cloudbeds dulu." }, { status: 409 });
      await simpanKonfigProperti(p.kode, { siap: true }, "admin_wizard_properti");
      return NextResponse.json({ ok: true, siap: true });
    }

    if (b.aksi === "nonaktifkan") {
      await simpanKonfigProperti(p.kode, { siap: false }, "admin_wizard_properti");
      return NextResponse.json({ ok: true, siap: false });
    }

    return NextResponse.json({ error: "aksi tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
