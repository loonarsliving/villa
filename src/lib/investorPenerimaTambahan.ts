import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Penerima tambahan WA investor (owner 2026-11-08): orang yang ikut
 * menerima laporan mingguan (dan pengumuman, dengan teks khusus) TANPA akun
 * investor aktif -- tidak bisa login, tidak muncul di daftar investor, bukti
 * transfer, atau perhitungan dividen. Susunan ini internal; teks laporan
 * sendiri tidak menyebut siapa memiliki unit apa.
 *
 * Disimpan di integration_settings 'laporan_investor_penerima_tambahan' =
 * { user_ids: string[] } (id villa_users; nama & HP dibaca dari akunnya,
 * aktif atau tidak). Diubah hanya atas permintaan owner.
 */
export const KUNCI_PENERIMA_TAMBAHAN = "laporan_investor_penerima_tambahan";

export async function ambilPenerimaTambahan(supabase: SupabaseClient): Promise<{ nama: string | null; hp: string | null }[]> {
  const { data: set, error: eS } = await supabase.from("integration_settings").select("value").eq("key", KUNCI_PENERIMA_TAMBAHAN).maybeSingle();
  if (eS) throw new Error(`gagal membaca penerima tambahan: ${eS.message}`);
  const ids = ((set?.value as { user_ids?: unknown } | null)?.user_ids ?? []) as unknown[];
  const bersih = ids.map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (!bersih.length) return [];
  const { data, error } = await supabase.from("villa_users").select("nama, hp").in("id", bersih);
  if (error) throw new Error(`gagal membaca akun penerima tambahan: ${error.message}`);
  return (data ?? []) as { nama: string | null; hp: string | null }[];
}
