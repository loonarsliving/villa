import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "./format";
import { kirimDariNomorUtama } from "./mkhsistemWa";
import { PENGUMUMAN, penerimaPengumuman, rapikanNama, type InvestorWa } from "./investorPengumumanText";
import { ambilPenerimaTambahan } from "./investorPenerimaTambahan";

/**
 * Pengumuman WhatsApp sekali kirim ke semua investor aktif (villa_users role
 * 'owner', is_active) -- jalur yang sama dengan laporan mingguan Rabu
 * (kirimDariNomorUtama, 0822 lewat Mkhsistem). Owner 2026-11-08: "kirim saat
 * ini dan hanya sekali ini".
 *
 * Sekali per nomor, SELAMANYA untuk satu PENGUMUMAN.id: nomor yang sudah
 * tercatat 'sent' dengan template_type = id itu di wa_messages_log
 * dilewati, jadi pemicu ganda (cron + manual) tidak mengirim dua kali.
 * Setelah PENGUMUMAN.berlakuSampai, tidak ada yang dikirim.
 */

export interface HasilPengumuman {
  id: string;
  lewat_masa_berlaku: boolean;
  penerima: number;
  nama_penerima: string[];
  terkirim: number;
  gagal: number;
  dilewati_sudah_terkirim: number;
  dilewati_atas_permintaan_owner: number;
  tanpa_nomor: number;
  dry_run: boolean;
}

export async function kirimPengumumanInvestor(
  supabase: SupabaseClient,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<HasilPengumuman> {
  const p = PENGUMUMAN;
  const hariIni = todayISO(opts.now ?? new Date());
  const hasil: HasilPengumuman = {
    id: p.id,
    lewat_masa_berlaku: hariIni > p.berlakuSampai,
    penerima: 0,
    nama_penerima: [],
    terkirim: 0,
    gagal: 0,
    dilewati_sudah_terkirim: 0,
    dilewati_atas_permintaan_owner: 0,
    tanpa_nomor: 0,
    dry_run: !!opts.dryRun,
  };
  if (hasil.lewat_masa_berlaku) return hasil;

  const { data: investor, error: eI } = await supabase
    .from("villa_users")
    .select("nama, hp")
    .eq("role", "owner")
    .eq("is_active", true)
    .order("created_at");
  if (eI) throw new Error(`gagal membaca investor: ${eI.message}`);
  const { penerima, tanpaNomor, dilewati } = penerimaPengumuman((investor ?? []) as InvestorWa[], p.lewati);
  hasil.dilewati_atas_permintaan_owner = dilewati;
  // Penerima tambahan tanpa akun aktif: teks khusus (tanpa menu dashboard).
  const tanpaAkses = new Set<string>();
  for (const t of await ambilPenerimaTambahan(supabase)) {
    const hp = String(t.hp ?? "").replace(/\D/g, "");
    if (hp.length < 8 || penerima.some((r) => r.hp === hp)) continue;
    penerima.push({ hp, nama: rapikanNama(String(t.nama ?? "")) || "Investor Loonars" });
    tanpaAkses.add(hp);
  }
  hasil.penerima = penerima.length;
  hasil.nama_penerima = penerima.map((r) => r.nama);
  hasil.tanpa_nomor = tanpaNomor;
  if (opts.dryRun || penerima.length === 0) return hasil;

  const { data: sudah, error: eS } = await supabase
    .from("wa_messages_log")
    .select("phone")
    .eq("template_type", p.id)
    .eq("status", "sent");
  // Tidak bisa memastikan siapa yang sudah menerima = jangan kirim apa pun.
  if (eS) throw new Error(`gagal membaca log WA: ${eS.message}`);
  const sudahTerkirim = new Set((sudah ?? []).map((r) => String(r.phone ?? "")));

  for (const r of penerima) {
    if (sudahTerkirim.has(r.hp)) {
      hasil.dilewati_sudah_terkirim++;
      continue;
    }
    const pesan = tanpaAkses.has(r.hp) ? p.teksTanpaAkses(r.nama) : p.teks(r.nama);
    const kirim = await kirimDariNomorUtama(r.hp, pesan);
    const { error: eLog } = await supabase.from("wa_messages_log").insert({
      phone: r.hp,
      message: pesan,
      template_type: p.id,
      status: kirim.success ? "sent" : "failed",
      response: kirim.success ? null : { error: kirim.error },
    });
    if (eLog) console.error("[investorPengumuman] gagal mencatat log WA", eLog.message);
    if (kirim.success) hasil.terkirim++;
    else {
      hasil.gagal++;
      console.error("[investorPengumuman] gagal mengirim", kirim.error);
    }
  }
  return hasil;
}
