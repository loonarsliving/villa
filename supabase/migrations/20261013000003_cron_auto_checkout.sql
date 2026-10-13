-- Jadwal check-out otomatis (owner 2026-10-13: tamu yang tidak diperpanjang
-- di-check-out otomatis jam 13.00 WIB di hari check-out). Memanggil
-- villa-api POST /cron/auto-checkout lewat villa_cron_post yang sama dengan
-- cron villa lainnya. 06.00 UTC = 13.00 WIB. Tidak mengubah skema.
select cron.unschedule('villa-auto-checkout')
where exists (select 1 from cron.job where jobname = 'villa-auto-checkout');

select cron.schedule('villa-auto-checkout', '0 6 * * *',
  $$select public.villa_cron_post('/cron/auto-checkout', 60000);$$);
