-- Multi-properti, persiapan EL masuk tabel bersama (owner 2026-11-04: "buat
-- smua fitur private living bisa dipakai el"; "jgan sampai menggangu private
-- living yg sedang berjalan"). Lihat docs/multi-properti/RENCANA.md.
--
-- 1. villa_commit_checkin mencatat pemasukan check-in ke `transactions`
--    tanpa menyebut properti, sehingga selalu jatuh ke DEFAULT 'PL'. Begitu
--    booking Excellent Living di-check-in lewat Front Desk, pemasukannya akan
--    tercatat sebagai Private Living dan ikut ke bagi hasil investor PL.
--    Sekarang property_kode transaksi = property_kode booking-nya. Untuk
--    booking PL hasilnya sama persis (semua booking saat ini 'PL').
--    Isi fungsi lain tidak berubah (diambil dari definisi live 2026-11-04).
--
-- 2. units.blok hanya boleh A/B/C -- itu blok villa Private Living. Aturan
--    itu kini hanya berlaku untuk unit PL; properti lain bebas (EL memakai
--    kode tipe kamar). Unit PL tidak terpengaruh.

create or replace function public.villa_commit_checkin(p_booking_id uuid, p_checkin_by text, p_ktp_photo_path text default null::text, p_signature_data_url text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_pin text;
  v_jumlah numeric;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if v_booking.status = 'checkin' then
    raise exception 'already_checked_in' using errcode = 'P0001';
  end if;
  if v_booking.status is distinct from 'terjadwal' then
    raise exception 'invalid_booking_status: %', v_booking.status using errcode = 'P0001';
  end if;
  if v_booking.total_bayar is null then
    raise exception 'booking_missing_total_bayar' using errcode = 'P0001';
  end if;

  v_jumlah := case
    when v_booking.sumber in ('agoda', 'booking.com', 'traveloka', 'airbnb', 'tiket')
         and v_booking.cloudbeds_subtotal is not null
      then v_booking.cloudbeds_subtotal
    else v_booking.total_bayar
  end;

  v_pin := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');

  update public.bookings set
    status = 'checkin',
    checkin_at = now(),
    checkin_by = p_checkin_by,
    pin_kode = v_pin,
    ktp_photo_path = coalesce(p_ktp_photo_path, ktp_photo_path),
    signature_data_url = coalesce(p_signature_data_url, signature_data_url)
  where id = p_booking_id;

  update public.units set status = 'occupied' where id = v_booking.unit_id;

  insert into public.transactions (unit_id, booking_id, tipe, kategori, deskripsi, jumlah, periode_bulan, dicatat_oleh, property_kode)
  values (
    v_booking.unit_id, p_booking_id, 'income', v_booking.tipe,
    'Check-in ' || v_booking.guest_nama || ' — Unit ' || coalesce(v_booking.unit_nomor, ''),
    v_jumlah, to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'), p_checkin_by,
    v_booking.property_kode
  );

  return jsonb_build_object(
    'success', true,
    'pin_kode', v_pin,
    'unit_id', v_booking.unit_id,
    'unit_nomor', v_booking.unit_nomor,
    'guest_id', v_booking.guest_id,
    'guest_nama', v_booking.guest_nama
  );
end;
$function$;

alter table public.units drop constraint if exists units_blok_check;
alter table public.units add constraint units_blok_check
  check (property_kode <> 'PL' or blok = any (array['A'::text, 'B'::text, 'C'::text]));
