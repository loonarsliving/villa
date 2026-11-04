-- Multi-properti: tutup buku & log audit Finance per properti (owner
-- 2026-11-04: "tutup buku per properti").
--
-- * finance_tutup_buku: kolom property_kode (DEFAULT 'PL'); aturan unik
--   "satu tutup buku per bulan" menjadi "per bulan per properti".
--   Tabel masih kosong saat migrasi ini ditulis (belum pernah tutup buku).
-- * finance_audit_log: kolom property_kode (DEFAULT 'PL'); 210 baris lama =
--   Private Living.
-- villa-api menyaring kedua tabel lewat klienProperti (TABEL_PER_PROPERTI).

do $$
declare
  t text;
begin
  foreach t in array array['finance_tutup_buku', 'finance_audit_log'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'property_kode'
    ) then
      execute format(
        'alter table public.%I add column property_kode text not null default %L references public.villa_properties(kode)',
        t, 'PL'
      );
    end if;
    execute format('create index if not exists %I on public.%I (property_kode)', t || '_property_kode_idx', t);
  end loop;
end $$;

alter table public.finance_tutup_buku drop constraint if exists finance_tutup_buku_periode_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'finance_tutup_buku_periode_properti_key') then
    alter table public.finance_tutup_buku add constraint finance_tutup_buku_periode_properti_key unique (periode, property_kode);
  end if;
end $$;

notify pgrst, 'reload schema';
