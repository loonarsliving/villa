-- Komisi OTA per channel (owner 2026-10-07: "benarkan, berarti komisi
-- sesuai aslinya").
--
-- Deposit Amount Cloudbeds (bookings.cloudbeds_subtotal) ternyata BELUM
-- selalu uang yang diterima villa: beberapa OTA masih memotong komisi dari
-- angka itu saat transfer. commission_pct = persen yang dipotong dari
-- Deposit Amount. Null = belum diketahui (dihitung 0) sampai ada bukti.

alter table public.finance_ota_settlement_config
  add column if not exists commission_pct numeric,
  add column if not exists commission_source text;

comment on column public.finance_ota_settlement_config.commission_pct is
  'Persen komisi OTA yang dipotong dari bookings.cloudbeds_subtotal saat OTA mentransfer. Null = belum diketahui (0).';
comment on column public.finance_ota_settlement_config.commission_source is
  'Bukti asal angka commission_pct (email pembayaran/voucher OTA).';

update public.finance_ota_settlement_config set
  commission_pct = 22,
  commission_source = 'Email Traveloka PAYMENT COMPLETED 7 Okt 2026: 3 booking dibayar tepat 78% dari Deposit Amount'
where sumber = 'traveloka';

update public.finance_ota_settlement_config set
  commission_pct = 17.2105,
  commission_source = 'Email konfirmasi Airbnb: biaya layanan tuan rumah 15,5% + PPN (1.300.000 -> diterima 1.076.264)'
where sumber = 'airbnb';

update public.finance_ota_settlement_config set
  commission_pct = 0,
  commission_source = 'Voucher Agoda: Deposit Amount Cloudbeds = Net rate Agoda (komisi 18% + pajak komisi sudah dipotong)'
where sumber = 'agoda';
