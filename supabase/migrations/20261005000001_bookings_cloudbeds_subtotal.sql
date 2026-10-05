-- Diterapkan langsung ke produksi 2026-10-05 (apply_migration
-- bookings_cloudbeds_subtotal); file ini mencatatnya di repo.
--
-- Cloudbeds MENAMBAHKAN fee OTA ke harga (email reservasi Booking.com:
-- harga 447.950 + "Booking.com Fee" 67.192,50 = Grand Total 515.142,50,
-- "Deposit Amount" 447.950). Owner: pendapatan villa = Deposit Amount =
-- balanceDetailed.subTotal. total_bayar tetap grandTotal.

alter table public.bookings add column if not exists cloudbeds_subtotal numeric;
comment on column public.bookings.cloudbeds_subtotal is 'Harga kamar dari Cloudbeds (balanceDetailed.subTotal = "Deposit Amount" di email reservasi), SEBELUM fee OTA yang Cloudbeds tambahkan ke grandTotal. Owner 2026-10-05: ini pendapatan bersih villa untuk booking OTA. total_bayar tetap grandTotal. Null untuk booking yang tidak berasal dari Cloudbeds.';
