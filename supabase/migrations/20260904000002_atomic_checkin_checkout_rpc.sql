-- Phase 1 (§6.2/§6.3 of the revenue-engine program): atomic check-in and
-- check-out.
--
-- APPLIED 2026-09-04 (owner-approved), and villa-api v26 (deployed same
-- day) now calls both RPCs from /checkin and /checkout. These two
-- functions replace villa-api's current sequential, unchecked multi-table
-- writes for /checkin and /checkout with a single-transaction Postgres
-- function: either every write succeeds, or none do, and a booking can
-- never be double-checked-in or double-checked-out (each function
-- row-locks the booking with `for update` and validates its current
-- status before doing anything).
--
-- These functions read guest_nama / tipe / total_bayar / unit_nomor
-- directly from the booking row rather than trusting values passed in
-- the request body from the client at check-in time — the booking's
-- total_bayar is the amount that was already validated/computed when the
-- booking was created (see villa-api phase1-draft's POST /bookings
-- change), so check-in commits that number rather than re-accepting a
-- fresh, unverified one from whoever happens to click "check-in".
--
-- Notifications and WhatsApp sends are intentionally NOT done inside
-- these functions — they stay in villa-api, called only after this RPC
-- returns success, so a WA-send failure can never roll back a successful
-- financial check-in/checkout (matches the program's explicit
-- instruction: "Notification failure must not invalidate successful
-- check-in").

create or replace function public.villa_commit_checkin(
  p_booking_id uuid,
  p_checkin_by text,
  p_ktp_photo_path text default null,
  p_signature_data_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_pin text;
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
    v_booking.total_bayar, to_char(now(), 'YYYY-MM'), p_checkin_by
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
$$;

create or replace function public.villa_commit_checkout(
  p_booking_id uuid,
  p_checkout_by text,
  p_kondisi text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  insert into public.housekeeping (unit_id, unit_nomor, tugas, tgl, jenis)
  values (
    v_booking.unit_id, v_booking.unit_nomor,
    'Bersihkan unit setelah checkout ' || v_booking.guest_nama,
    current_date, 'bersih'
  );

  return jsonb_build_object(
    'success', true,
    'unit_id', v_booking.unit_id,
    'unit_nomor', v_booking.unit_nomor,
    'guest_id', v_booking.guest_id,
    'guest_nama', v_booking.guest_nama
  );
end;
$$;

-- Rollback (for reference, not run automatically):
--   drop function if exists public.villa_commit_checkin(uuid, text, text, text);
--   drop function if exists public.villa_commit_checkout(uuid, text, text);
--
-- SECURITY DEFINER is used because these run with the same effective
-- privilege villa-api already uses (service-role, which bypasses RLS) —
-- consistent with every other write villa-api performs today, not a
-- privilege escalation. search_path is pinned to `public` to avoid the
-- classic SECURITY DEFINER search-path hijack risk.
