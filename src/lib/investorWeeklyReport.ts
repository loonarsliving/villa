import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "./format";
import { kirimDariNomorUtama } from "./mkhsistemWa";
import { addDaysISO } from "./stayDates";
import { geser, hitungLaporan, periodeMingguLalu, teksLaporan, type BookingRingkas } from "./investorWeeklyReportText";

/**
 * Laporan mingguan WhatsApp ke semua investor aktif (villa_users role
 * 'owner', is_active) -- permintaan owner 2026-10-07, tiap 7 hari.
 * Angka dan teks: investorWeeklyReportText.ts. Dikirim dari 0822 lewat
 * Mkhsistem, sama seperti sambutan OTA.
 *
 * Satu kali per nomor per minggu, dijaga lewat wa_messages_log: kalau cron
 * terpicu dua kali (atau dipicu manual setelah cron), nomor yang sudah
 * menerima laporan dalam 3 hari terakhir dilewati.
 */

const TEMPLATE = "investor_weekly_report";

export interface HasilLaporanMingguan {
  periode: { mulai: string; akhir: string };
  pesan: string;
  penerima: number;
  terkirim: number;
  gagal: number;
  dilewati_sudah_terkirim: number;
  tanpa_nomor: number;
  dry_run: boolean;
}

export async function kirimLaporanMingguanInvestor(
  supabase: SupabaseClient,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<HasilLaporanMingguan> {
  const now = opts.now ?? new Date();
  const p = periodeMingguLalu(todayISO(now));
  const awal = geser(p, -7).mulai;
  const akhirPlus1 = addDaysISO(geser(p, 7).akhir, 1);

  const [{ data: bookings, error: eB }, { count: jumlahUnit, error: eU }] = await Promise.all([
    supabase
      .from("bookings")
      .select("sumber, status, unit_nomor, tgl_checkin, tgl_checkout, total_bayar, cloudbeds_subtotal, created_at")
      .lte("tgl_checkin", akhirPlus1)
      .gt("tgl_checkout", awal),
    supabase.from("units").select("id", { count: "exact", head: true }),
  ]);
  if (eB) throw new Error(`gagal membaca booking: ${eB.message}`);
  if (eU) throw new Error(`gagal membaca unit: ${eU.message}`);

  // Booking baru bisa bertanggal check-in jauh di depan; ambil terpisah.
  const { data: baru, error: eN } = await supabase
    .from("bookings")
    .select("sumber, status, unit_nomor, tgl_checkin, tgl_checkout, total_bayar, cloudbeds_subtotal, created_at")
    .gte("created_at", `${p.mulai}T00:00:00+07:00`)
    .lt("created_at", `${addDaysISO(p.akhir, 1)}T00:00:00+07:00`)
    .gt("tgl_checkin", akhirPlus1);
  if (eN) throw new Error(`gagal membaca booking baru: ${eN.message}`);

  const semua = [...(bookings ?? []), ...(baru ?? [])] as BookingRingkas[];
  const laporan = hitungLaporan(semua, jumlahUnit ?? 0, p, (iso) => todayISO(new Date(iso)));
  const pesan = teksLaporan(laporan);

  const { data: investor, error: eI } = await supabase
    .from("villa_users")
    .select("hp")
    .eq("role", "owner")
    .eq("is_active", true);
  if (eI) throw new Error(`gagal membaca investor: ${eI.message}`);

  const nomor = new Set<string>();
  let tanpaNomor = 0;
  for (const inv of investor ?? []) {
    const hp = String(inv.hp ?? "").replace(/\D/g, "");
    if (hp.length < 8) tanpaNomor++;
    else nomor.add(hp);
  }

  const hasil: HasilLaporanMingguan = {
    periode: p,
    pesan,
    penerima: nomor.size,
    terkirim: 0,
    gagal: 0,
    dilewati_sudah_terkirim: 0,
    tanpa_nomor: tanpaNomor,
    dry_run: !!opts.dryRun,
  };
  if (opts.dryRun || nomor.size === 0) return hasil;

  const tigaHariLalu = new Date(now.getTime() - 3 * 86400000).toISOString();
  const { data: sudah } = await supabase
    .from("wa_messages_log")
    .select("phone")
    .eq("template_type", TEMPLATE)
    .eq("status", "sent")
    .gte("created_at", tigaHariLalu);
  const sudahTerkirim = new Set((sudah ?? []).map((r) => String(r.phone ?? "")));

  for (const hp of nomor) {
    if (sudahTerkirim.has(hp)) {
      hasil.dilewati_sudah_terkirim++;
      continue;
    }
    const kirim = await kirimDariNomorUtama(hp, pesan);
    const { error: eLog } = await supabase.from("wa_messages_log").insert({
      phone: hp,
      message: pesan,
      template_type: TEMPLATE,
      status: kirim.success ? "sent" : "failed",
      response: kirim.success ? null : { error: kirim.error },
    });
    if (eLog) console.error("[investorWeeklyReport] gagal mencatat log WA", eLog.message);
    if (kirim.success) hasil.terkirim++;
    else {
      hasil.gagal++;
      console.error("[investorWeeklyReport] gagal mengirim", kirim.error);
    }
  }
  return hasil;
}
