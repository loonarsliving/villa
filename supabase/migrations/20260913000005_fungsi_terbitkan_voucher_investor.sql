-- Menerbitkan 12 kode menginap gratis untuk satu pemegang atas satu unit.
--
-- Dibuat karena ini akan terjadi lagi: owner menyebut (13 Sep 2026) akan ada
-- dua investor baru yang mengisi A4 dan A5, dan setiap pergantian pemilik
-- berikutnya butuh hal yang sama. Menuliskan ulang loop kode acak setiap kali
-- adalah cara paling mudah menghasilkan kode bentrok, kode di bulan yang
-- salah, atau jumlah yang tidak dua belas.
--
-- Aman diulang: kalau kodenya sudah pernah diterbitkan untuk pemegang, unit,
-- dan bulan yang sama, baris itu dilewati, bukan digandakan.
create or replace function public.villa_terbitkan_voucher_investor(
  p_user_id      uuid,
  p_unit_id      uuid,
  p_bulan_mulai  date default date '2026-10-01',
  p_jumlah_bulan int  default 12
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Tanpa O/0/I/1: kode ini dibacakan lewat telepon dan diketik ulang di HP.
  huruf     text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bulan     int;
  percobaan int;
  kode      text;
  -- Awalan v_ bukan gaya-gayaan: variabel bernama "periode" bentrok dengan
  -- kolom bernama sama, dan PL/pgSQL menolak kuerinya sebagai ambigu.
  v_periode date;
  dibuat    int := 0;
  sudah     boolean;
begin
  if p_jumlah_bulan < 1 or p_jumlah_bulan > 36 then
    raise exception 'jumlah bulan di luar batas wajar: %', p_jumlah_bulan;
  end if;
  if extract(day from p_bulan_mulai) <> 1 then
    raise exception 'bulan mulai harus tanggal 1, bukan %', p_bulan_mulai;
  end if;

  for bulan in 0..(p_jumlah_bulan - 1) loop
    v_periode := (p_bulan_mulai + (bulan || ' month')::interval)::date;

    select exists(
      select 1 from villa_investor_vouchers v
      where v.user_id = p_user_id and v.unit_id = p_unit_id and v.periode = v_periode
    ) into sudah;
    if sudah then continue; end if;

    for percobaan in 1..50 loop
      kode := '';
      for i in 1..8 loop
        kode := kode || substr(huruf, 1 + floor(random() * length(huruf))::int, 1);
      end loop;
      begin
        insert into villa_investor_vouchers (user_id, unit_id, kode, periode)
        values (p_user_id, p_unit_id, kode, v_periode);
        dibuat := dibuat + 1;
        exit;
      exception when unique_violation then
        if exists(select 1 from villa_investor_vouchers v
                  where v.user_id = p_user_id and v.unit_id = p_unit_id and v.periode = v_periode) then
          exit;
        end if;
      end;
      if percobaan = 50 then
        raise exception 'gagal menemukan kode unik untuk % / % / %', p_user_id, p_unit_id, v_periode;
      end if;
    end loop;
  end loop;

  return dibuat;
end $$;

revoke all on function public.villa_terbitkan_voucher_investor(uuid, uuid, date, int) from public, anon, authenticated;

comment on function public.villa_terbitkan_voucher_investor(uuid, uuid, date, int) is
  'Menerbitkan 12 kode menginap gratis untuk satu pemegang atas satu unit. Aman diulang. Dipakai saat unit berganti pemilik: pemilik baru mendapat kodenya sendiri, kode pemilik lama tetap berlaku sampai bulannya lewat.';
