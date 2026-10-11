-- Status "sudah dibaca" notifikasi per akun investor (disetujui owner
-- 2026-10-11: "Ya" atas usulan menambah satu kolom batas-terbaca per akun).
--
-- notifications.is_read_owner adalah SATU kolom untuk semua investor, jadi
-- satu investor membuka halaman Notifikasi menghapus badge merah semua
-- investor. Investor tetap melihat notifikasi SEMUA unit (owner: bagi hasil
-- kumulatif, tidak per unit), jadi yang dibutuhkan adalah waktu terakhir
-- akun ini membuka Notifikasi.
--
-- Aditif: satu kolom nullable, tidak ada data yang diubah. NULL = akun ini
-- belum pernah membuka Notifikasi sejak kolom ini ada; villa-api lalu
-- memakai is_read_owner lama sebagai cadangan, jadi tampilan saat ini tidak
-- berubah tiba-tiba.

alter table public.villa_users
  add column if not exists notif_dibaca_sampai timestamptz;

comment on column public.villa_users.notif_dibaca_sampai is
  'Investor: notifikasi dengan created_at <= nilai ini sudah dibaca oleh akun ini. NULL = pakai notifications.is_read_owner.';
