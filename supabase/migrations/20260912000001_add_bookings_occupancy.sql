-- Jumlah tamu per booking, disetujui owner 2026-09-12.
--
-- Alasannya Cloudbeds: postReservation dan putReservation dua-duanya minta
-- adults[] dan children[] per tipe kamar, dan sampai sekarang villa-api
-- mengirim ANGKA TETAP 1 dewasa 0 anak untuk setiap pemesanan web -- bukan
-- karena itu benar, tapi karena form di loonars.id tidak pernah menanyakannya.
-- Jadi okupansi di Cloudbeds (dan lewat Cloudbeds, di semua OTA) salah
-- setiap kali tamunya lebih dari satu orang.
--
-- Default 1/0 dipilih supaya seluruh baris yang sudah ada -- termasuk
-- reservasi hasil sinkronisasi dari Cloudbeds, yang jumlah tamunya tidak
-- pernah kita simpan -- tetap sah tanpa menebak isinya, dan supaya jalur
-- booking staf yang belum menanyakan jumlah tamu berperilaku persis seperti
-- sebelum migrasi ini.
alter table bookings add column if not exists adults integer not null default 1;
alter table bookings add column if not exists children integer not null default 0;

-- Penjaga di level database, bukan cuma di form: jumlah tamu negatif atau
-- nol dewasa bukan booking yang masuk akal, dan Cloudbeds akan menolaknya
-- dengan "Invalid Parameters" yang tidak menyebut field-nya sama sekali.
alter table bookings drop constraint if exists bookings_occupancy_sane;
alter table bookings add constraint bookings_occupancy_sane
  check (adults >= 1 and adults <= 20 and children >= 0 and children <= 20);
