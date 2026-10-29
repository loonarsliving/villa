-- Payment Gateway Loonars Excellent Living (owner 2026-10-29): EL memakai
-- QRIS statisnya sendiri (merchant "LOONARS", NMID ID1026627194701, terpisah
-- dari QRIS Private Living di integration_settings.walkin_qris). Gambar QRIS
-- EL disimpan sebagai data di integration_settings key 'el_qris' (bukan
-- skema). Migrasi ini hanya menambah status bayar per booking EL.
--
-- Sama seperti Payment Gateway Private Living: QRIS statis tidak membawa
-- nominal dan tidak ada konfirmasi otomatis -- klik "Tandai Lunas" oleh
-- resepsionis setelah mencocokkan mutasi rekening ITULAH catatannya.

alter table public.el_bookings
  add column if not exists status_bayar text not null default 'belum'
    check (status_bayar in ('belum', 'lunas')),
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by text;
