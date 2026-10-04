-- Kode menginap gratis investor di loonars.id tidak pernah bisa dipakai
-- (dilaporkan owner 2026-10-04, layar tamu: "new row for relation
-- "bookings" violates check constraint "bookings_sumber_check"").
--
-- villa-api /public/bookings menyimpan booking dengan kode investor sebagai
-- sumber 'investor', tapi nilai itu tidak pernah ditambahkan ke daftar
-- CHECK. Dicek langsung di database 2026-10-04: belum ada satu pun baris
-- sumber 'investor', jadi fitur ini belum pernah berhasil sekali pun.
--
-- Hanya menambah satu nilai ke daftar yang diizinkan. Tidak ada baris yang
-- diubah. Daftar lama dibaca langsung dari database 2026-10-04.
alter table bookings drop constraint if exists bookings_sumber_check;
alter table bookings add constraint bookings_sumber_check
  check (sumber = any (array['walk-in','airbnb','tiket','agoda','booking.com','website','whatsapp','other','cloudbeds','traveloka','google','late-night','investor']));
