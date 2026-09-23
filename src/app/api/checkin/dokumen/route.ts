import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { periksaTokenStaf } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "guest-documents";
/**
 * Umur URL bertanda tangan untuk foto KTP. Sengaja pendek: URL ini membuka
 * data pribadi tamu tanpa perlu login lagi, jadi kalau tersalin ke mana-mana
 * (riwayat browser, tangkapan layar, salah kirim) ia mati dengan sendirinya.
 * Lima menit cukup untuk dilihat di meja depan saat melayani tamu.
 */
const SIGNED_URL_TTL_DETIK = 300;

/**
 * Membaca kembali dokumen check-in satu booking: foto KTP dan tanda tangan
 * tamu di atas tata tertib.
 *
 * Kenapa ini ada: keduanya sudah dikumpulkan sejak 2026-08-27, tapi sampai
 * 2026-09-20 TIDAK ADA satu pun endpoint atau halaman yang membacanya
 * kembali -- diperiksa di seluruh src/ dan villa-api. Artinya seluruh proses
 * ambil KTP + tanda tangan bersifat sekali tulis: villa menanggung risiko
 * menyimpan data pribadi tamu tanpa pernah bisa memakainya saat sengketa
 * (denda merokok Rp500.000, ganti rugi kerusakan, keterlambatan check-out) --
 * padahal itu satu-satunya alasan mengumpulkannya.
 *
 * Ditaruh di Next.js, bukan di villa-api, karena dua hal: bucket
 * `guest-documents` privat sehingga butuh service role (pola yang sama
 * dengan /api/checkin/upload-ktp yang menulisnya), dan villa-api hanya bisa
 * ter-deploy lewat GitHub Actions yang tokennya sedang bermasalah
 * (lihat DEPLOYMENT.md).
 *
 * Gerbangnya `periksaTokenStaf`: admin dan resepsionis saja. Investor (role
 * `owner`) ditolak villa-api di /summary, jadi tidak pernah bisa sampai ke
 * KTP tamu.
 */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenStaf(token) : "ditolak";
  if (sesi === "gagal-periksa") {
    // 503, BUKAN 401: klien mengeluarkan pengguna dari aplikasi setiap kali
    // menerima 401, dan gangguan sesaat tidak boleh melempar resepsionis ke
    // halaman login di tengah check-in.
    return NextResponse.json(
      { error: "Sesi tidak bisa diperiksa sekarang — jaringan atau villa-api sedang terganggu. Coba lagi sebentar lagi, jangan keluar dari aplikasi." },
      { status: 503 },
    );
  }
  if (sesi !== "lolos") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bookingId = new URL(request.url).searchParams.get("booking_id") ?? "";
  // bookings.id bertipe uuid: nilai lain membuat Postgres menolak query
  // mentah-mentah dan berubah jadi 500, bukan "tidak ditemukan".
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    return NextResponse.json({ error: "booking_id tidak valid" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = supabaseAdmin();
  } catch {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi" }, { status: 503 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id,guest_nama,unit_nomor,tipe,sumber,status,tgl_checkin,tgl_checkout,checkin_at,checkin_by,ktp_photo_path,signature_data_url",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!booking) return NextResponse.json({ error: "Booking tidak ditemukan" }, { status: 404 });

  let ktpUrl: string | null = null;
  let ktpError: string | null = null;
  if (booking.ktp_photo_path) {
    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(booking.ktp_photo_path, SIGNED_URL_TTL_DETIK);
    if (signErr) ktpError = signErr.message;
    else ktpUrl = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    booking: {
      id: booking.id,
      guest_nama: booking.guest_nama,
      unit_nomor: booking.unit_nomor,
      tipe: booking.tipe,
      sumber: booking.sumber,
      status: booking.status,
      tgl_checkin: booking.tgl_checkin,
      tgl_checkout: booking.tgl_checkout,
      checkin_at: booking.checkin_at,
      checkin_by: booking.checkin_by,
    },
    ktpUrl,
    ktpError,
    signatureDataUrl: booking.signature_data_url ?? null,
    berlakuDetik: SIGNED_URL_TTL_DETIK,
  });
}
