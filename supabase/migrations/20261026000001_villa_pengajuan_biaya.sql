-- Pengajuan biaya operasional villa (laundry, Netflix, lain-lain).
-- Owner 2026-10-26: manager villa (Rebecca) mengajukan dari dashboard
-- manager atau dari chat Loonars Connect (Mkhsistem); Finance villa
-- menyetujui/menolak dan mengunggah bukti transfer dari dashboard Finance;
-- semuanya tercatat di Finance villa. Mulai periode 2026-11, total pengajuan
-- sebulan menjadi COGS bulan itu (perubahan rumus terpisah, lihat
-- CURRENT_STATE.md) -- migrasi ini hanya menyimpan datanya.
--
-- Satu tabel ini adalah sumber kebenaran untuk dua jalur masuk (dashboard
-- lewat villa-api, chat lewat RPC Mkhsistem). Riwayat ditulis trigger, jadi
-- kedua jalur tercatat dengan cara yang sama.
--
-- Aditif: tabel baru + bucket privat baru. RLS aktif TANPA policy = hanya
-- service role (villa-api, rute Next.js) dan fungsi security definer.

create table if not exists public.villa_pengajuan_biaya (
  id uuid primary key default gen_random_uuid(),
  nomor bigint generated always as identity unique,
  -- lain_lain: manager menulis sendiri nama biayanya di kategori_nama
  -- (owner 2026-10-26: "biarkan manager menulis dengan sendirinya").
  kategori text not null check (kategori in ('laundry', 'netflix', 'lain_lain')),
  kategori_nama text check (length(kategori_nama) <= 80),
  -- permintaan_dana: Finance mentransfer ke penerima (vendor / manager).
  -- reimburse: manager sudah membayar sendiri, Finance mengganti.
  jenis text not null check (jenis in ('permintaan_dana', 'reimburse')),
  -- Bulan biaya ini dipakai (YYYY-MM), bukan bulan transfernya.
  periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  nominal bigint not null check (nominal > 0 and nominal <= 100000000),
  keterangan text not null check (length(trim(keterangan)) between 3 and 1000),
  penerima_nama text check (length(penerima_nama) <= 120),
  penerima_bank text check (length(penerima_bank) <= 60),
  penerima_rekening text check (length(penerima_rekening) <= 40),
  -- Objek di bucket villa-pengajuan-biaya.
  nota_path text,
  bukti_bayar_path text,
  status text not null default 'diajukan'
    check (status in ('diajukan', 'disetujui', 'ditolak', 'ditransfer', 'dibatalkan')),
  diajukan_lewat text not null check (diajukan_lewat in ('dashboard', 'chat')),
  diajukan_oleh_nama text not null,
  diajukan_oleh_villa_user uuid references public.villa_users(id) on delete set null,
  -- employees.id di Mkhsistem (jalur chat); sengaja tanpa FK agar tabel villa
  -- tidak bergantung pada skema Mkhsistem.
  diajukan_oleh_employee uuid,
  diputus_oleh_nama text,
  diputus_at timestamptz,
  catatan_finance text check (length(catatan_finance) <= 1000),
  alasan_tolak text check (length(alasan_tolak) <= 1000),
  bukti_transfer_path text,
  tanggal_transfer date,
  ditransfer_oleh_nama text,
  ditransfer_at timestamptz,
  alasan_batal text check (length(alasan_batal) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kategori <> 'lain_lain' or length(trim(coalesce(kategori_nama, ''))) >= 3),
  check (jenis <> 'reimburse' or bukti_bayar_path is not null),
  check (status <> 'ditolak' or length(trim(coalesce(alasan_tolak, ''))) > 0),
  check (status <> 'dibatalkan' or length(trim(coalesce(alasan_batal, ''))) > 0),
  check (status <> 'ditransfer' or (bukti_transfer_path is not null and tanggal_transfer is not null))
);

create index if not exists villa_pengajuan_biaya_status_idx on public.villa_pengajuan_biaya (status, created_at desc);
create index if not exists villa_pengajuan_biaya_periode_idx on public.villa_pengajuan_biaya (periode, status);

create table if not exists public.villa_pengajuan_biaya_log (
  id uuid primary key default gen_random_uuid(),
  pengajuan_id uuid not null references public.villa_pengajuan_biaya(id) on delete cascade,
  status text not null,
  oleh_nama text,
  catatan text,
  created_at timestamptz not null default now()
);
create index if not exists villa_pengajuan_biaya_log_idx on public.villa_pengajuan_biaya_log (pengajuan_id, created_at);

create or replace function public.villa_pengajuan_biaya_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger villa_pengajuan_biaya_updated_at
  before update on public.villa_pengajuan_biaya
  for each row execute function public.villa_pengajuan_biaya_updated_at();

-- Satu baris riwayat per perubahan status, apa pun jalurnya.
create or replace function public.villa_pengajuan_biaya_catat()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  insert into public.villa_pengajuan_biaya_log (pengajuan_id, status, oleh_nama, catatan)
  values (
    new.id, new.status,
    case new.status
      when 'diajukan' then new.diajukan_oleh_nama
      when 'dibatalkan' then new.diajukan_oleh_nama
      when 'ditransfer' then new.ditransfer_oleh_nama
      else new.diputus_oleh_nama
    end,
    case new.status
      when 'ditolak' then new.alasan_tolak
      when 'dibatalkan' then new.alasan_batal
      when 'disetujui' then new.catatan_finance
      else null
    end
  );
  return null;
end;
$$;

create trigger villa_pengajuan_biaya_catat
  after insert or update on public.villa_pengajuan_biaya
  for each row execute function public.villa_pengajuan_biaya_catat();

alter table public.villa_pengajuan_biaya enable row level security;
alter table public.villa_pengajuan_biaya_log enable row level security;

comment on table public.villa_pengajuan_biaya is
  'Pengajuan biaya operasional villa oleh manager, disetujui + ditransfer Finance villa. Sumber COGS aktual mulai 2026-11. Service role saja.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('villa-pengajuan-biaya', 'villa-pengajuan-biaya', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
