-- Uji perilaku migrasi 20261026000001_villa_pengajuan_biaya.sql.
-- Jalankan di database lokal kosong (lihat README.md). Tiap cek mencetak PASS/FAIL.
\set QUIET on
\pset tuples_only on
create temp table hasil (nama text, lulus boolean);
grant all on hasil to authenticated;

create or replace function pg_temp.harus_gagal(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation or not_null_violation or foreign_key_violation or insufficient_privilege then
  return true;
end $$;

insert into villa_users (id, nama) values ('00000000-0000-0000-0000-000000000001', 'Rebecca');

insert into villa_pengajuan_biaya (kategori, jenis, periode, nominal, keterangan, nota_path, diajukan_lewat, diajukan_oleh_nama, diajukan_oleh_villa_user)
values ('laundry', 'permintaan_dana', '2026-11', 350000, 'Laundry minggu 1', 'nota/a.jpg', 'dashboard', 'Rebecca', '00000000-0000-0000-0000-000000000001');

insert into hasil select 'insert dasar + nomor urut', (select nomor = 1 from villa_pengajuan_biaya);
insert into hasil select 'log diajukan tertulis', (select count(*) = 1 and bool_and(status = 'diajukan' and oleh_nama = 'Rebecca') from villa_pengajuan_biaya_log);

insert into hasil select 'lain-lain tanpa nama ditolak', pg_temp.harus_gagal($$insert into villa_pengajuan_biaya (kategori, jenis, periode, nominal, keterangan, diajukan_lewat, diajukan_oleh_nama) values ('lain_lain','permintaan_dana','2026-11',50000,'Gas elpiji','chat','Rebecca')$$);
insert into villa_pengajuan_biaya (kategori, kategori_nama, jenis, periode, nominal, keterangan, diajukan_lewat, diajukan_oleh_nama)
values ('lain_lain', 'Gas elpiji', 'permintaan_dana', '2026-11', 50000, 'Isi ulang 2 tabung', 'chat', 'Rebecca');
insert into hasil select 'lain-lain dengan nama diterima', (select count(*) = 1 from villa_pengajuan_biaya where kategori_nama = 'Gas elpiji');

insert into hasil select 'kategori lama "operasional" ditolak', pg_temp.harus_gagal($$insert into villa_pengajuan_biaya (kategori, jenis, periode, nominal, keterangan, diajukan_lewat, diajukan_oleh_nama) values ('operasional','permintaan_dana','2026-11',1,'abc','chat','x')$$);
insert into hasil select 'reimburse tanpa bukti bayar ditolak', pg_temp.harus_gagal($$insert into villa_pengajuan_biaya (kategori, jenis, periode, nominal, keterangan, diajukan_lewat, diajukan_oleh_nama) values ('netflix','reimburse','2026-11',186000,'Netflix','chat','x')$$);
insert into hasil select 'nominal 0 ditolak', pg_temp.harus_gagal($$insert into villa_pengajuan_biaya (kategori, jenis, periode, nominal, keterangan, diajukan_lewat, diajukan_oleh_nama) values ('netflix','permintaan_dana','2026-11',0,'Netflix','chat','x')$$);
insert into hasil select 'periode salah ditolak', pg_temp.harus_gagal($$insert into villa_pengajuan_biaya (kategori, jenis, periode, nominal, keterangan, diajukan_lewat, diajukan_oleh_nama) values ('netflix','permintaan_dana','2026-13',1,'Netflix','chat','x')$$);
insert into hasil select 'tolak tanpa alasan ditolak', pg_temp.harus_gagal($$update villa_pengajuan_biaya set status = 'ditolak' where nomor = 1$$);
insert into hasil select 'batal tanpa alasan ditolak', pg_temp.harus_gagal($$update villa_pengajuan_biaya set status = 'dibatalkan' where nomor = 1$$);

update villa_pengajuan_biaya set status = 'disetujui', diputus_oleh_nama = 'Finance', diputus_at = now() where nomor = 1;
update villa_pengajuan_biaya set catatan_finance = 'ok' where nomor = 1;
insert into hasil select 'ubah non-status tidak menambah log', (select count(*) = 2 from villa_pengajuan_biaya_log l join villa_pengajuan_biaya p on p.id = l.pengajuan_id where p.nomor = 1);
insert into hasil select 'ditransfer tanpa bukti ditolak', pg_temp.harus_gagal($$update villa_pengajuan_biaya set status = 'ditransfer' where nomor = 1$$);

update villa_pengajuan_biaya set status = 'ditransfer', bukti_transfer_path = 'bukti/a.jpg', tanggal_transfer = '2026-11-02', ditransfer_oleh_nama = 'Finance', ditransfer_at = now() where nomor = 1;
insert into hasil select 'log lengkap diajukan>disetujui>ditransfer', (
  select array_agg(l.status || ':' || coalesce(l.oleh_nama, '') order by l.created_at) = array['diajukan:Rebecca', 'disetujui:Finance', 'ditransfer:Finance']
  from villa_pengajuan_biaya_log l join villa_pengajuan_biaya p on p.id = l.pengajuan_id where p.nomor = 1);
insert into hasil select 'updated_at diperbarui', (select updated_at >= created_at from villa_pengajuan_biaya where nomor = 1);

delete from villa_users;
insert into hasil select 'hapus akun pengaju: pengajuan tetap ada, pengaju dikosongkan', (select count(*) = 1 from villa_pengajuan_biaya where nomor = 1 and diajukan_oleh_villa_user is null);

insert into hasil select 'bucket privat dibuat', (select not public and file_size_limit = 10485760 from storage.buckets where id = 'villa-pengajuan-biaya');
insert into hasil select 'RLS aktif di kedua tabel', (select bool_and(relrowsecurity) from pg_class where relname in ('villa_pengajuan_biaya', 'villa_pengajuan_biaya_log'));

set role authenticated;
insert into hasil select 'pengguna login biasa tidak melihat apa pun', (select count(*) = 0 from villa_pengajuan_biaya);
insert into hasil select 'pengguna login biasa tidak bisa menulis', pg_temp.harus_gagal($$insert into villa_pengajuan_biaya (kategori, jenis, periode, nominal, keterangan, diajukan_lewat, diajukan_oleh_nama) values ('netflix','permintaan_dana','2026-11',1,'abc','chat','x')$$);
reset role;

select case when lulus then 'PASS ' else 'FAIL ' end || nama from hasil;
select format('%s/%s lulus', count(*) filter (where lulus), count(*)) from hasil;
