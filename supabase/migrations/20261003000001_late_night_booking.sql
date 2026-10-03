-- Late night booking (latenight.loonars.id), diminta owner 2026-10-03.
--
-- Permintaan owner: subdomain loonars.id khusus late night booking yang
-- hanya bisa diakses Laila (marketing late night) lewat login. Tamu menginap
-- jam 01.00 sampai 09.00 WIB, tarif tetap Rp260.000, dibayar lewat QRIS
-- statis villa. Jawaban owner atas pertanyaan desain (2026-10-03):
--   - "260 yg benar": yang ditagih DAN dicatat sebagai pemasukan Rp260.000;
--   - Laila sendiri yang menekan Lunas (sekaligus kirim PIN pintu);
--   - hanya unit tipe Standard;
--   - pemasukan ikut bagi hasil investor seperti booking biasa.
--
-- Skema yang berubah hanya dua daftar CHECK. Tidak ada tabel baru: booking
-- late night adalah baris `bookings` biasa (satu malam, malam KEMARIN
-- s/d hari ini, karena tamunya datang lewat tengah malam), sehingga
-- pengecekan bentrok, exclusion constraint bookings_no_overlap_active,
-- villa_commit_checkin (pemasukan -> transactions -> bagi hasil), checkout,
-- dan housekeeping semuanya memakai jalur yang sudah ada.

-- ── 1. role baru ─────────────────────────────────────────────────────────
-- Daftar lama dibaca langsung dari database 2026-10-03 (bukan dari ingatan):
-- owner, receptionist, admin, security, cleaning_service, finance, manager.
alter table villa_users drop constraint if exists villa_users_role_check;
alter table villa_users add constraint villa_users_role_check
  check (role = any (array['owner','receptionist','admin','security','cleaning_service','finance','manager','late_night']));

-- ── 2. sumber booking baru ───────────────────────────────────────────────
-- Daftar lama dibaca langsung dari database 2026-10-03.
alter table bookings drop constraint if exists bookings_sumber_check;
alter table bookings add constraint bookings_sumber_check
  check (sumber = any (array['walk-in','airbnb','tiket','agoda','booking.com','website','whatsapp','other','cloudbeds','traveloka','google','late-night']));
