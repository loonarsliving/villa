-- Multi-properti: Loonars Excellent Living pindah ke tabel bersama
-- (owner 2026-11-04: "Sinkronkan dan nyalakan, kamar hanya ada 31 dan bawa
-- ke production"). Lihat docs/multi-properti/RENCANA.md.
--
-- Menyalin (bukan memindah) data EL dari tabel el_* ke tabel bersama dengan
-- property_kode 'EL':
--   el_room_types (aktif: DOU, QUA, JSP, KIN)  -> villa_room_types
--   el_rooms (aktif: 31 kamar)                -> units (blok = kode tipe)
--   el_cloudbeds_room_mapping (4)             -> cloudbeds_room_mapping
-- el_bookings dan el_housekeeping kosong saat migrasi ini ditulis (dicek).
-- Tabel el_* TIDAK dihapus atau diubah.
--
-- Private Living tidak terpengaruh: rumus dan halaman PL membaca tabel ini
-- lewat klienProperti (hanya 'PL'), fungsi MK Connect disaring PL
-- (Mkhsistem 0313/0314). Idempoten (on conflict do nothing).

do $$
begin
  if (select count(*) from public.el_bookings) > 0 or (select count(*) from public.el_housekeeping) > 0 then
    raise exception 'el_bookings/el_housekeeping tidak kosong -- salin booking EL dulu sebelum migrasi ini';
  end if;
end $$;

insert into public.villa_room_types (code, name, description, capacity, active, property_kode)
select t.kode, t.nama, t.deskripsi, t.kapasitas, true, 'EL'
  from public.el_room_types t
 where t.active
on conflict (code) do nothing;

insert into public.units (nomor, blok, status, room_type_id, catatan, property_kode)
select r.nomor, t.kode, r.status, vt.id, r.catatan, 'EL'
  from public.el_rooms r
  join public.el_room_types t on t.id = r.room_type_id
  join public.villa_room_types vt on vt.code = t.kode and vt.property_kode = 'EL'
 where r.active
 order by r.sort_order, r.nomor
on conflict (nomor) do nothing;

insert into public.cloudbeds_room_mapping (cloudbeds_room_id, cloudbeds_room_name, unit_id, property_kode)
select m.cloudbeds_room_id, m.cloudbeds_room_name, u.id, 'EL'
  from public.el_cloudbeds_room_mapping m
  join public.el_rooms r on r.id = m.room_id
  join public.units u on u.nomor = r.nomor and u.property_kode = 'EL'
on conflict (cloudbeds_room_id) do nothing;
