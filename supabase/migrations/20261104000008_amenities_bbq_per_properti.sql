-- Multi-properti: amenities & pesanan BBQ/add-on per properti (owner
-- 2026-11-04: "amenities dan bbq samakan").
--
-- property_kode DEFAULT 'PL' di amenities (stok), amenity_kit_items (isi
-- paket per kamar), amenity_usage_log, addon_orders. Semua baris lama =
-- 'PL'. villa-api menyaring keempatnya lewat klienProperti, jadi stok dan
-- pesanan EL terpisah dari PL. Pesanan BBQ publik (loonars.id + QRIS)
-- tetap milik PL sampai QRIS & website EL tersedia.

do $$
declare
  t text;
begin
  foreach t in array array['amenities', 'amenity_kit_items', 'amenity_usage_log', 'addon_orders'] loop
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

notify pgrst, 'reload schema';
