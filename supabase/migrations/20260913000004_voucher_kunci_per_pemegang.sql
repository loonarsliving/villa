-- Kuncinya pindah dari (unit_id, periode) ke (user_id, unit_id, periode).
--
-- Keputusan owner 13 Sep 2026: kalau A4 dan A5 nanti diisi dua investor baru,
-- mereka mendapat kode sendiri DAN Bu Mega tetap memegang kodenya. Di bawah
-- kunci lama itu mustahil -- kode Oktober untuk A4 hanya boleh ada satu, jadi
-- pemilik baru A4 tidak akan bisa diberi kode Oktober sama sekali, tanpa
-- penjelasan apa pun selain galat unique.
--
-- Yang tetap dijaga: satu PEMEGANG tidak bisa punya dua kode untuk unit yang
-- sama di bulan yang sama -- itu aturan "sebulan sekali" yang sesungguhnya.
alter table public.villa_investor_vouchers
  drop constraint if exists villa_investor_vouchers_satu_per_unit_per_bulan;

alter table public.villa_investor_vouchers
  add constraint villa_investor_vouchers_satu_per_pemegang_per_unit_per_bulan
  unique (user_id, unit_id, periode);

comment on column public.villa_investor_vouchers.unit_id is
  'Unit yang menjadi dasar pemberian kode (12 poin per unit per tahun). BUKAN pembatas tempat menginap -- kode boleh dipakai di unit mana saja yang kosong. Kalau unit berganti pemilik, pemilik baru mendapat kodenya sendiri dan kode pemilik lama tetap berlaku sampai bulannya lewat.';
