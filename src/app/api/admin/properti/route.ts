import { NextResponse } from "next/server";

import { supabaseAdmin, supabaseAdminProperti } from "@/lib/supabaseAdmin";
import { periksaTokenAdmin } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin menambah / mengubah properti (owner 2026-11-04: "admin itu bisa
 * menambahkan properti baru dgan mudah"). Kode 2-6 huruf besar, unik, tidak
 * bisa diubah setelah dibuat (dipakai di semua tabel per properti).
 * Private Living tidak bisa dinonaktifkan.
 */
async function sesiAdmin(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenAdmin(token) : "ditolak";
  if (sesi === "gagal-periksa") return NextResponse.json({ error: "Sesi tidak bisa diperiksa, coba lagi" }, { status: 503 });
  if (sesi !== "lolos") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export async function POST(request: Request) {
  const tolak = await sesiAdmin(request);
  if (tolak) return tolak;
  const b = (await request.json().catch(() => ({}))) as { kode?: unknown; nama?: unknown };
  const kode = String(b.kode ?? "").trim().toUpperCase();
  const nama = String(b.nama ?? "").trim();
  if (!/^[A-Z]{2,6}$/.test(kode)) return NextResponse.json({ error: "Kode properti 2-6 huruf (contoh: LVB)" }, { status: 400 });
  if (nama.length < 3 || nama.length > 80) return NextResponse.json({ error: "Nama properti 3-80 karakter" }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("villa_properties").insert({ kode, nama, aktif: true }).select("kode, nama, aktif").single();
  if (error) {
    const pesan = error.code === "23505" ? `Kode ${kode} sudah dipakai` : error.message;
    return NextResponse.json({ error: pesan }, { status: error.code === "23505" ? 409 : 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const tolak = await sesiAdmin(request);
  if (tolak) return tolak;
  const b = (await request.json().catch(() => ({}))) as { kode?: unknown; nama?: unknown; aktif?: unknown };
  const kode = String(b.kode ?? "");
  const isi: Record<string, unknown> = {};
  if (typeof b.nama === "string") {
    const nama = b.nama.trim();
    if (nama.length < 3 || nama.length > 80) return NextResponse.json({ error: "Nama properti 3-80 karakter" }, { status: 400 });
    isi.nama = nama;
  }
  if (typeof b.aktif === "boolean") {
    if (kode === "PL" && !b.aktif) return NextResponse.json({ error: "Private Living tidak bisa dinonaktifkan" }, { status: 400 });
    isi.aktif = b.aktif;
  }
  if (!kode || !Object.keys(isi).length) return NextResponse.json({ error: "kode dan perubahan wajib diisi" }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("villa_properties").update(isi).eq("kode", kode).select("kode, nama, aktif").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Properti tidak ditemukan" }, { status: 404 });
  return NextResponse.json(data);
}

/**
 * Hapus properti (owner 2026-11-04: "sy tidak punya tombol hapus property").
 * Hanya properti yang SUDAH NONAKTIF, bukan PL/EL, dan belum punya data apa
 * pun (kamar, booking, akun karyawan). Pengaturannya (kunci Cloudbeds, email,
 * QRIS, harga) ikut dihapus. Properti yang sudah dipakai cukup dinonaktifkan.
 */
export async function DELETE(request: Request) {
  const tolak = await sesiAdmin(request);
  if (tolak) return tolak;
  const kode = String(new URL(request.url).searchParams.get("kode") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(kode)) return NextResponse.json({ error: "kode tidak valid" }, { status: 400 });
  if (kode === "PL" || kode === "EL") return NextResponse.json({ error: "Properti ini tidak bisa dihapus" }, { status: 400 });
  const db = supabaseAdmin();
  const { data: p } = await db.from("villa_properties").select("kode, nama, aktif").eq("kode", kode).maybeSingle();
  if (!p) return NextResponse.json({ error: "Properti tidak ditemukan" }, { status: 404 });
  if (p.aktif) return NextResponse.json({ error: "Nonaktifkan properti dulu sebelum menghapus" }, { status: 409 });

  const pb = supabaseAdminProperti(kode);
  const [kamar, booking, akun] = await Promise.all([
    pb.from("units").select("id", { count: "exact", head: true }),
    pb.from("bookings").select("id", { count: "exact", head: true }),
    db.from("villa_users").select("id", { count: "exact", head: true }).eq("property_kode", kode),
  ]);
  const ada: string[] = [];
  if ((kamar.count ?? 0) > 0) ada.push(`${kamar.count} kamar`);
  if ((booking.count ?? 0) > 0) ada.push(`${booking.count} booking`);
  if ((akun.count ?? 0) > 0) ada.push(`${akun.count} akun karyawan`);
  if (ada.length) return NextResponse.json({ error: `Tidak bisa dihapus karena sudah punya data: ${ada.join(", ")}. Cukup biarkan nonaktif.` }, { status: 409 });

  const kecil = kode.toLowerCase();
  await db.from("integration_settings").delete().in("key", [`properti_${kecil}`, `payment_email_${kecil}`, `${kecil}_qris`, `${kecil}_dynamic_pricing`]);
  const { error } = await db.from("villa_properties").delete().eq("kode", kode);
  if (error) {
    const pesan = error.code === "23503" ? "Properti ini masih dipakai data lain, jadi tidak bisa dihapus. Biarkan nonaktif." : error.message;
    return NextResponse.json({ error: pesan }, { status: error.code === "23503" ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, kode, nama: p.nama });
}
