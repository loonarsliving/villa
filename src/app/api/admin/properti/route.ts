import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
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
  if (!/^[A-Z]{2,6}$/.test(kode)) return NextResponse.json({ error: "Kode properti 2-6 huruf (contoh: LV3)" }, { status: 400 });
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
