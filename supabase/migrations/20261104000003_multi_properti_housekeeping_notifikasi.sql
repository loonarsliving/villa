-- Multi-properti: tabel operasional Front Desk/Manager ikut per properti
-- (owner 2026-11-04: "buat smua fitur private living bisa dipakai el"; "jgan
-- sampai menggangu private living yg sedang berjalan").
--
-- Aditif. Kolom property_kode NOT NULL DEFAULT 'PL' di:
--   * housekeeping          -- tugas bersih kamar (dibuat checkout)
--   * notifications         -- notifikasi staf Front Desk
--   * villa_room_checks     -- cek kesiapan kamar oleh manager
--   * villa_room_maintenance-- kamar ditutup maintenance
-- Semua baris lama = 'PL'. villa-api & Next.js menyaring tabel ini lewat
-- klienProperti (TABEL_PER_PROPERTI), jadi PL hanya melihat PL.
--
-- villa_commit_checkout membuat tugas housekeeping tanpa menyebut properti
-- (selalu jatuh ke 'PL'); kini property_kode = booking.property_kode. Isi
-- fungsi lain tidak berubah (diambil dari definisi live 2026-11-04), tetap
-- SECURITY DEFINER + search_path public.

do $$
declare
  t text;
begin
  foreach t in array array['housekeeping', 'notifications', 'villa_room_checks', 'villa_room_maintenance'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'property_kode'
    ) then
      execute format(
        'alter table public.%I add column property_kode text not null default %L references public.villa_properties(kode)',
        t, 'PL'
      );
    end if;
    execute format('create index if not exists %I on public.%I (property_kode)', t || '_property_kode_idx', t);
  end loop;
end $$;

create or replace function public.villa_commit_checkout(p_booking_id uuid, p_checkout_by text, p_kondisi text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if v_booking.status = 'checkout' then
    raise exception 'already_checked_out' using errcode = 'P0001';
  end if;
  if v_booking.status is distinct from 'checkin' then
    raise exception 'invalid_booking_status: %', v_booking.status using errcode = 'P0001';
  end if;

  update public.bookings set
    status = 'checkout',
    checkout_at = now(),
    checkout_by = p_checkout_by,
    catatan = p_kondisi
  where id = p_booking_id;

  update public.units set status = 'dirty' where id = v_booking.unit_id;

  insert into public.housekeeping (unit_id, unit_nomor, tugas, tgl, jenis, property_kode)
  values (
    v_booking.unit_id, v_booking.unit_nomor,
    'Bersihkan unit setelah checkout ' || v_booking.guest_nama,
    (now() at time zone 'Asia/Jakarta')::date, 'bersih',
    v_booking.property_kode
  );

  return jsonb_build_object(
    'success', true,
    'unit_id', v_booking.unit_id,
    'unit_nomor', v_booking.unit_nomor,
    'guest_id', v_booking.guest_id,
    'guest_nama', v_booking.guest_nama
  );
end;
$function$;

notify pgrst, 'reload schema';
