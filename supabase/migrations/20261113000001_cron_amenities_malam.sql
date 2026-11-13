-- Pemotongan stok amenities per kamar per malam (owner 2026-11-13: "setiap
-- kamar permalam 1 amenities"). Memanggil villa-api POST /cron/amenities-malam
-- lewat villa_cron_post yang sama dengan cron villa lainnya.
-- 16.30 UTC = 23.30 WIB. Tidak mengubah skema.
select cron.unschedule('villa-amenities-malam')
where exists (select 1 from cron.job where jobname = 'villa-amenities-malam');

select cron.schedule('villa-amenities-malam', '30 16 * * *',
  $$select public.villa_cron_post('/cron/amenities-malam', 60000);$$);
