-- Adds invoice numbering + proof-of-payment tracking to bookings, for the
-- public booking site's "Confirm Payment" (upload bukti transfer) -> "Cetak
-- Invoice" (PDF) flow. QRIS payment stays static/manual -- no automated
-- payment-gateway verification is added. Applied to production via
-- apply_migration on 2026-09-11.

alter table public.bookings
  add column if not exists invoice_no text,
  add column if not exists bukti_pembayaran_path text,
  add column if not exists bukti_pembayaran_at timestamptz;

comment on column public.bookings.invoice_no is 'Nomor invoice untuk booking dari public booking site (loonars.id), diisi saat tamu upload bukti transfer.';
comment on column public.bookings.bukti_pembayaran_path is 'Path di storage bucket guest-documents untuk bukti transfer yang diupload tamu lewat public booking site.';
comment on column public.bookings.bukti_pembayaran_at is 'Waktu bukti transfer diupload oleh tamu.';

create unique index if not exists bookings_invoice_no_key on public.bookings(invoice_no) where invoice_no is not null;
