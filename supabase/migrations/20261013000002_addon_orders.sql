-- Pesanan add-on terpisah dari booking kamar (disetujui owner 2026-10-13:
-- "Setuju, A"). Pertama dipakai untuk BBQ Family Package yang dipesan
-- sendiri lewat loonars.id/bbq oleh tamu yang sudah booking (termasuk OTA).
--
-- Sengaja tabel sendiri, bukan baris di `bookings`: pesanan ini tidak
-- memegang unit, tidak masuk kalender, dan BUKAN pendapatan kamar -- jadi
-- tidak pernah ikut laporan pendapatan, dividen, atau okupansi investor.
-- Pilihan A: siapa pun boleh memesan; `info_menginap` diisi tamu (nama di
-- booking / nomor unit) dan resepsionis yang mencocokkan.
--
-- Dibayar lewat QRIS statis yang sama: total_bayar = harga + kode_unik, dan
-- villa-api mencocokkan email BTN / balasan LUNAS ke tabel ini juga.

create table if not exists public.addon_orders (
  id            uuid primary key default gen_random_uuid(),
  item          text not null,
  qty           int  not null check (qty between 1 and 10),
  harga         numeric not null check (harga >= 0),
  kode_unik     int  not null default 0 check (kode_unik between 0 and 999),
  total_bayar   numeric not null check (total_bayar >= 0),
  guest_nama    text not null,
  hp            text not null,
  tanggal       date not null,
  info_menginap text,
  catatan       text,
  status        text not null default 'menunggu_pembayaran'
                check (status in ('menunggu_pembayaran', 'lunas', 'batal')),
  invoice_no    text,
  paid_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists addon_orders_status_created_idx on public.addon_orders (status, created_at);

alter table public.addon_orders enable row level security;
revoke all on public.addon_orders from anon, authenticated;
