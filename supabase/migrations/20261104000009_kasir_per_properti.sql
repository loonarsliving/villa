-- Multi-properti: pembayaran kasir (walkin_payments) ikut per properti
-- (owner 2026-11-04: QRIS Excellent Living dipakai di kasir EL; "lanjutkan
-- sampai live"). Aditif: property_kode NOT NULL DEFAULT 'PL' -- semua baris
-- lama otomatis 'PL', jadi laporan/kasir Private Living tidak berubah.
-- villa-api menyaring tabel ini lewat klienProperti (TABEL_PER_PROPERTI).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'walkin_payments' and column_name = 'property_kode'
  ) then
    alter table public.walkin_payments
      add column property_kode text not null default 'PL' references public.villa_properties(kode);
  end if;
  create index if not exists walkin_payments_property_kode_idx on public.walkin_payments (property_kode);
end $$;

notify pgrst, 'reload schema';
