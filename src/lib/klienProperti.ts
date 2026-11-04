import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PENGAMAN MULTI-PROPERTI (owner 2026-11-04: "betul buat sj pgaman, dan jgan
 * sampai menggangu private living yg sedang berjalan").
 *
 * Kode villa ditulis saat hanya ada satu properti, jadi banyak rumus uang
 * menghitung SEMUA baris units/bookings (contoh: dividen investor = 70% dari
 * pendapatan semua booking bulan itu; okupansi = malam terjual / jumlah
 * semua unit). Begitu Loonars Excellent Living (EL) masuk ke tabel yang
 * sama, rumus-rumus itu akan ikut menghitung EL.
 *
 * Klien ini membungkus koneksi Supabase sehingga untuk TABEL_PER_PROPERTI:
 *   - select / update / delete otomatis + `.eq('property_kode', properti)`;
 *   - insert / upsert otomatis mengisi `property_kode` bila belum diisi.
 * Semua kode lama tetap memakai `supabaseAdmin()` dan otomatis hanya
 * melihat Private Living ('PL'). Kode yang memang untuk properti lain harus
 * meminta klien properti itu secara eksplisit.
 *
 * Padanan di villa-api (Deno, tidak bisa berbagi file):
 * supabase/functions/villa-api/index.ts `klienProperti`. Ubah keduanya.
 */

export const TABEL_PER_PROPERTI = new Set([
  "units",
  "villa_room_types",
  "bookings",
  "transactions",
  "finance_settlements",
  "cloudbeds_room_mapping",
  "villa_daily_inventory_snapshot",
  "housekeeping",
  "notifications",
  "villa_room_checks",
  "villa_room_maintenance",
  "finance_tutup_buku",
  "finance_audit_log",
  "villa_guest_directory",
]);

export type KodeProperti = "PL" | "EL";
export const PROPERTI_BAWAAN: KodeProperti = "PL";

function isiProperti<T>(rows: T, properti: string): T {
  const isi = (r: unknown) =>
    r && typeof r === "object" && !("property_kode" in (r as Record<string, unknown>)) ? { ...(r as Record<string, unknown>), property_kode: properti } : r;
  return (Array.isArray(rows) ? rows.map(isi) : isi(rows)) as T;
}

type Builder = Record<string, (...a: unknown[]) => unknown>;

export function klienProperti<C extends SupabaseClient>(klien: C, properti: string = PROPERTI_BAWAAN): C {
  return new Proxy(klien, {
    get(target, prop, receiver) {
      if (prop !== "from") {
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      }
      return (tabel: string) => {
        const qb = target.from(tabel) as unknown as Builder;
        if (!TABEL_PER_PROPERTI.has(tabel)) return qb;
        return new Proxy(qb, {
          get(b, p, r) {
            const asli = Reflect.get(b, p, r);
            if (typeof asli !== "function") return asli;
            if (p === "select" || p === "update" || p === "delete") {
              return (...a: unknown[]) => (asli.apply(b, a) as Builder).eq("property_kode", properti);
            }
            if (p === "insert" || p === "upsert") {
              return (rows: unknown, ...rest: unknown[]) => asli.apply(b, [isiProperti(rows, properti), ...rest]);
            }
            return asli.bind(b);
          },
        });
      };
    },
  }) as C;
}
