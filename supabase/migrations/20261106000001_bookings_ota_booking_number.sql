-- Nomor booking OTA (owner 2026-11-06: finance mengunggah daftar payout
-- Booking.com/Agoda dan sistem mencocokkan per booking).
--
-- Strictly additive: satu kolom nullable + indeks parsial. Tidak mengubah
-- baris yang ada. Diisi saat finance mencocokkan daftar payout (pertama lewat
-- nama tamu + tanggal, berikutnya cocok lewat nomor ini).
alter table public.bookings add column if not exists ota_booking_number text;

create index if not exists bookings_ota_booking_number_idx
  on public.bookings (ota_booking_number)
  where ota_booking_number is not null;
