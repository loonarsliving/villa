-- Tutup buku bulanan Finance villa (owner 2026-11-01).
--
-- Owner: "fitur tutup buku di finance ... dapat tutup buku dan melihat mana
-- saja yang belum cair dari OTA mana saja di bulan itu", dan "agar finance
-- tutup buku dengan sisa piutang dari OTA yang belum masuk uangnya".
-- Owner menyetujui tabel baru ini ("Ya, boleh") dan memilih BULAN CHECK-IN
-- sebagai dasar bulan (sama dengan Pendapatan, Laba Rugi, Checklist Dana).
--
-- Satu baris per bulan. Saat ditutup, villa-api menyimpan rekap Checklist
-- Dana bulan itu (snapshot): total seharusnya / sudah masuk / sisa piutang,
-- per channel, dan daftar booking yang belum cair. Dana yang cair SETELAH
-- tutup buku tetap boleh dicentang di Checklist Dana (OTA sering membayar di
-- bulan berikutnya); halaman Tutup Buku menandainya "cair setelah tutup
-- buku" dengan membandingkan snapshot dengan data hari ini.
--
-- Tabel ini tidak dibaca oleh rumus apa pun (laporan, bagi hasil investor,
-- dividen, harga). Riwayat tutup / buka kembali juga ditulis ke
-- finance_audit_log oleh villa-api.
--
-- Aditif: hanya tabel baru. RLS aktif TANPA policy = hanya service role
-- (villa-api).

create table if not exists public.finance_tutup_buku (
  id uuid primary key default gen_random_uuid(),
  -- Bulan check-in yang ditutup (YYYY-MM).
  periode text not null unique check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null check (status in ('ditutup', 'dibuka_kembali')),
  -- Angka saat ditutup (rupiah bulat, dari finance_settlements).
  total_seharusnya bigint not null default 0,
  total_diterima bigint not null default 0,
  total_piutang bigint not null default 0,
  jumlah_booking integer not null default 0,
  jumlah_booking_piutang integer not null default 0,
  -- { totals, per_channel, piutang: [ {booking_id, guest_nama, unit_nomor,
  --   sumber, cloudbeds_reservation_id, tgl_checkin, tgl_checkout,
  --   seharusnya, expected_settlement_date} ] }
  snapshot jsonb not null,
  catatan text check (length(catatan) <= 1000),
  ditutup_oleh uuid,
  ditutup_oleh_nama text,
  ditutup_at timestamptz not null default now(),
  dibuka_oleh_nama text,
  dibuka_at timestamptz,
  alasan_buka text check (length(alasan_buka) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'dibuka_kembali' or length(trim(coalesce(alasan_buka, ''))) > 0)
);

alter table public.finance_tutup_buku enable row level security;
