import { NextResponse } from "next/server";
import { periksaTokenStaf } from "@/lib/villaApiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daftar percakapan WhatsApp untuk halaman Chat Front Desk, terurut pesan
 * terbaru dulu. Staf saja (admin/resepsionis) -- sama seperti seluruh
 * jalur check-in, lihat alasan tri-state 401 vs 503 di villaApiAuth.ts.
 */
export async function GET(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  const sesi = token ? await periksaTokenStaf(token) : "ditolak";
  if (sesi === "gagal-periksa") {
    return NextResponse.json(
      { error: "Sesi tidak bisa diperiksa sekarang — jaringan atau villa-api sedang terganggu. Coba lagi sebentar lagi." },
      { status: 503 },
    );
  }
  if (sesi !== "lolos") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("wa_conversations")
    .select(
      "id,phone,nama_tampilan,guest_id,booking_id,status_tamu,last_message_at,last_message_preview,unread_count,bahasa," +
        "guests(nama),bookings(unit_nomor,status,tgl_checkin,tgl_checkout)",
    )
    .order("last_message_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
