-- Paket dekorasi (Birthday / Honeymoon / Anniversary) sebagai add-on booking
-- website, dibayar sekalian lewat QRIS (disetujui owner 2026-10-13).
--
-- Harga paket SENGAJA disimpan terpisah dan TIDAK masuk ke `tarif` maupun
-- `total_bayar`. Owner: "Pendapatan paket tidak include ke investor".
-- Laporan pendapatan, dividen, dan okupansi membaca `total_bayar`/`tarif`,
-- jadi selama paket berada di kolom sendiri angka investor tidak berubah.
-- Yang ditagih ke tamu (dan dicocokkan ke email BTN QRIS) adalah
-- total_bayar + harga_paket -- lihat tagihanTamu() di villa-api.
--
-- Murni penambahan kolom; baris lama mendapat harga_paket 0 dan
-- paket_dekorasi null.

alter table public.bookings
  add column if not exists paket_dekorasi text,
  add column if not exists harga_paket numeric not null default 0 check (harga_paket >= 0);

comment on column public.bookings.paket_dekorasi is 'Nama paket dekorasi add-on (mis. "Honeymoon Medium"); null = tanpa paket.';
comment on column public.bookings.harga_paket is 'Harga paket dekorasi. Bukan pendapatan kamar: tidak dibagi ke investor, tidak termasuk total_bayar.';
