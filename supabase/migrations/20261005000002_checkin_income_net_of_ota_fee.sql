-- Pemasukan yang dicatat saat check-in (dasar bagi hasil / dividen
-- investor) memakai harga kamar SEBELUM fee OTA, bukan Grand Total.
--
-- Owner 2026-10-05, setuju setelah dijelaskan: Cloudbeds menambahkan fee
-- OTA ke Grand Total (Booking.com 15%, Traveloka ~22%, Airbnb 15%), dan
-- fee itu tidak pernah diterima villa -- jadi dasar dividen ikut terlalu
-- tinggi. Untuk booking OTA yang punya bookings.cloudbeds_subtotal, angka
-- itulah yang dicatat; selain itu (website, walk-in, investor, late night,
-- atau booking OTA lama tanpa subtotal) tetap total_bayar seperti dulu.
--
-- Satu-satunya perubahan dari 20260904000002 adalah nilai jumlah di insert
-- transactions.

create or replace function public.villa_commit_checkin(
  p_booking_id uuid,
  p_checkin_by text,
  p_ktp_photo_path text default null,
  p_signature_data_url text default null
)
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

  insert into public.transactions (unit_id, booking_id, tipe, kategori, deskripsi, jumlah, periode_bulan, dicatat_oleh)
  values (
    v_booking.unit_id, p_booking_id, 'income', v_booking.tipe,
    'Check-in ' || v_booking.guest_nama || ' — Unit ' || coalesce(v_booking.unit_nomor, ''),
    v_jumlah, to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'), p_checkin_by
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
