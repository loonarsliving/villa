-- Login menolak email yang hurufnya berbeda besar-kecil.
--
-- Ditemukan 14 Sep 2026 dari tangkapan layar investor: ia mengetik
-- "Mega@haluoleo.id" dan dijawab "Email atau password salah", padahal
-- akunnya ada. Papan ketik ponsel MENGAWALI SETIAP KOLOM DENGAN HURUF
-- BESAR secara bawaan, jadi ini bukan kecerobohan satu orang -- setiap
-- investor yang login dari HP dan tidak menyadarinya akan mengalami hal
-- yang sama, dan pesan galatnya justru menuduh passwordnya yang salah.
--
-- Email bukan data yang peka huruf besar-kecil (bagian domainnya memang
-- tidak, dan tidak ada penyedia email sungguhan yang membedakan bagian
-- sebelum @). Membandingkannya apa adanya tidak pernah menambah keamanan,
-- hanya menambah kegagalan login.
create or replace function public.villa_login(p_email text, p_password text)
returns table(id uuid, nama text, role text, unit_id uuid, unit_nomor text, is_active boolean, must_change_password boolean)
language sql
as $function$
  select id, nama, role, unit_id, unit_nomor, is_active, must_change_password
  from villa_users
  where lower(email) = lower(btrim(p_email))
    and password_hash = extensions.crypt(p_password, password_hash)
  limit 1;
$function$;

-- Kalau dua akun hanya berbeda besar-kecil hurufnya, "lower(email)" di atas
-- bisa cocok dengan dua baris dan limit 1 akan memilih salah satunya secara
-- sewenang-wenang -- orang bisa masuk ke akun yang bukan miliknya. Indeks ini
-- membuat keadaan itu mustahil, bukan sekadar tidak mungkin terjadi hari ini.
create unique index if not exists villa_users_email_unik_tanpa_huruf_besar
  on public.villa_users (lower(email));
