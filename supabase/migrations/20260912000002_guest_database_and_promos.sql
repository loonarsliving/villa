-- Modul database tamu + promo, disetujui owner 2026-09-12.
--
-- Tujuan owner: "kt punya database tamu" dari OTA maupun web, lalu admin
-- bisa membuat promo yang dipakai AI untuk menjangkau tamu lama saat low
-- season -- "promo itu tentu dgan batasan harga yg sdh kt buat".
--
-- Keputusan yang membentuk skema ini:
--
-- 1. TIDAK ada tabel tamu baru. Kontak tamu sudah hidup di `guests`, dan
--    menyalinnya ke tabel kedua akan langsung menciptakan dua versi nomor
--    HP yang sama. Yang ditambah hanya keadaan yang TIDAK bisa diturunkan
--    dari data yang ada (status berhenti-langganan, catatan), sementara
--    statistik menginap dihitung di view.
--
-- 2. Promo TIDAK menyimpan angka diskon. Harganya mengaktifkan batas bawah
--    yang sudah ada di villa_room_types.min_rate (instruksi owner: "kt kan
--    punya harga batas bawah ... ai akn akan memakai harga paling bawah
--    kita, nah bisa pakai seolah2 sedang ada promo untuk mngaktifkan harga
--    bawah itu"). Jadi tidak ada wewenang harga baru yang diciptakan:
--    lantai harga tetap satu-satunya, dan promo hanya memanggilnya.
--
-- 3. RLS mengikuti pola pengerasan 2026-09-08: RLS ON dengan SATU policy
--    service_role. anon/authenticated punya grant SELECT dari bawaan
--    Supabase, tapi tanpa policy untuk mereka, RLS mengembalikan nol baris.
--    Ini penting justru di modul ini: isinya nomor HP dan email tamu.

-- ── 1. keadaan pemasaran per tamu ────────────────────────────────────────
create table if not exists villa_guest_marketing (
  guest_id uuid primary key references guests(id) on delete cascade,
  -- Berhenti-langganan per kanal, bukan satu tombol: tamu bisa tidak mau
  -- di-WA tapi tidak keberatan dikirimi email.
  wa_opt_out boolean not null default false,
  email_opt_out boolean not null default false,
  catatan text,
  terakhir_dikirimi_promo timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2. promo ─────────────────────────────────────────────────────────────
create table if not exists villa_promos (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama text not null,
  deskripsi text,

  -- 'batas_bawah' = pakai villa_room_types.min_rate tipe kamarnya.
  -- 'harga_tetap' = harga yang diisi admin, TETAP dijepit tidak boleh di
  -- bawah min_rate oleh villa-api; kolom ini bukan jalan pintas melewati
  -- lantai harga.
  mode_harga text not null default 'batas_bawah'
    check (mode_harga in ('batas_bawah','harga_tetap')),
  harga_per_malam numeric,

  -- null = berlaku untuk semua tipe kamar
  room_type_id uuid references villa_room_types(id) on delete cascade,

  -- dua jendela yang berbeda, dan keduanya perlu: kapan promo boleh DIPESAN,
  -- dan untuk tanggal menginap yang mana. Promo low season yang tidak
  -- membatasi tanggal menginap akan dipakai orang untuk tahun baru.
  pesan_dari date,
  pesan_sampai date,
  menginap_dari date,
  menginap_sampai date,

  min_malam integer not null default 1,
  kuota integer,
  terpakai integer not null default 0,
  aktif boolean not null default true,
  dibuat_oleh text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint villa_promos_harga_tetap_wajib check (
    mode_harga <> 'harga_tetap' or (harga_per_malam is not null and harga_per_malam > 0)
  ),
  constraint villa_promos_min_malam_wajar check (min_malam >= 1 and min_malam <= 60),
  constraint villa_promos_kuota_wajar check (kuota is null or kuota >= 0),
  constraint villa_promos_jendela_pesan check (pesan_dari is null or pesan_sampai is null or pesan_sampai >= pesan_dari),
  constraint villa_promos_jendela_menginap check (menginap_dari is null or menginap_sampai is null or menginap_sampai >= menginap_dari)
);

create index if not exists villa_promos_aktif_idx on villa_promos (aktif, pesan_dari, pesan_sampai);

-- ── 3. usulan kiriman promo yang menunggu persetujuan owner ──────────────
-- Owner memilih: "AI usul, saya setujui via WA". Jadi usulannya harus
-- berwujud baris yang bisa disetujui, bukan niat yang hidup di memori satu
-- proses AI.
create table if not exists villa_promo_batches (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references villa_promos(id) on delete cascade,
  -- Owner membalas "PROMO <kode>" -- pola yang sama dengan LUNAS <kode>
  -- yang sudah berjalan, supaya tidak ada cara baru yang perlu dihafal.
  kode_konfirmasi text not null unique,
  alasan text,
  okupansi_persen numeric,
  jumlah_penerima integer not null default 0,
  pesan text not null,
  status text not null default 'menunggu'
    check (status in ('menunggu','disetujui','terkirim','ditolak','kedaluwarsa')),
  hasil jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz
);

create index if not exists villa_promo_batches_status_idx on villa_promo_batches (status, created_at desc);

-- ── 4. catatan pengiriman ────────────────────────────────────────────────
create table if not exists villa_promo_sends (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references villa_promo_batches(id) on delete cascade,
  promo_id uuid not null references villa_promos(id) on delete cascade,
  guest_id uuid references guests(id) on delete set null,
  kanal text not null default 'whatsapp' check (kanal in ('whatsapp','email')),
  -- Nomor/alamat disimpan apa adanya saat dikirim. Tanpa ini, tamu yang
  -- nomornya berubah membuat catatan pengiriman jadi tidak bisa dibaca
  -- ulang: kita tahu "dikirim", tapi tidak tahu ke mana.
  tujuan text,
  status text not null default 'terkirim' check (status in ('terkirim','gagal','dilewati')),
  error text,
  sent_at timestamptz not null default now()
);

-- Satu tamu maksimal satu kali per batch. Ini penjaga yang membuat
-- pengiriman bisa diulang dengan aman kalau separuh jalan gagal.
create unique index if not exists villa_promo_sends_batch_guest_uniq
  on villa_promo_sends (batch_id, guest_id) where batch_id is not null and guest_id is not null;

-- ── 5. pemakaian promo di booking ────────────────────────────────────────
-- Tabel terpisah, BUKAN kolom baru di bookings: owner minta modul ini tidak
-- mengubah tabel yang sudah ada. Kebetulan bentuk ini juga lebih baik --
-- harga normal ikut tercatat, jadi selalu bisa dijawab "promo ini
-- sebenarnya memotong berapa".
create table if not exists villa_promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references villa_promos(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  guest_id uuid references guests(id) on delete set null,
  harga_normal numeric,
  harga_promo numeric,
  malam integer,
  created_at timestamptz not null default now()
);

create unique index if not exists villa_promo_redemptions_booking_uniq
  on villa_promo_redemptions (booking_id) where booking_id is not null;

-- ── 6. direktori tamu (statistik diturunkan, tidak disimpan) ─────────────
-- security_invoker: view ini berjalan dengan hak pemanggilnya, jadi RLS di
-- guests/bookings tetap berlaku lewatnya. Tanpa itu, view akan menjadi
-- lubang yang membocorkan seluruh kontak tamu ke pemegang anon key --
-- persis kelas masalah yang ditutup pengerasan RLS 2026-09-08.
create or replace view villa_guest_directory
with (security_invoker = true) as
select
  g.id as guest_id,
  g.nama,
  g.hp,
  g.email,
  count(b.id) filter (where b.status in ('terjadwal','checkin','checkout')) as jumlah_menginap,
  min(b.tgl_checkin) filter (where b.status in ('terjadwal','checkin','checkout')) as pertama_menginap,
  max(b.tgl_checkin) filter (where b.status in ('terjadwal','checkin','checkout')) as terakhir_menginap,
  coalesce(sum(coalesce(b.total_bayar, b.tarif, 0)) filter (where b.status in ('terjadwal','checkin','checkout')), 0) as total_belanja,
  (array_agg(b.sumber order by b.created_at nulls last))[1] as sumber_pertama,
  coalesce(m.wa_opt_out, false) as wa_opt_out,
  coalesce(m.email_opt_out, false) as email_opt_out,
  m.terakhir_dikirimi_promo,
  m.catatan
from guests g
left join bookings b on b.guest_id = g.id
left join villa_guest_marketing m on m.guest_id = g.id
group by g.id, g.nama, g.hp, g.email, m.wa_opt_out, m.email_opt_out, m.terakhir_dikirimi_promo, m.catatan;

-- ── 7. RLS: service_role saja, sama seperti guests/bookings ──────────────
alter table villa_guest_marketing enable row level security;
alter table villa_promos enable row level security;
alter table villa_promo_batches enable row level security;
alter table villa_promo_sends enable row level security;
alter table villa_promo_redemptions enable row level security;

drop policy if exists srole_villa_guest_marketing on villa_guest_marketing;
create policy srole_villa_guest_marketing on villa_guest_marketing for all to service_role using (true) with check (true);

drop policy if exists srole_villa_promos on villa_promos;
create policy srole_villa_promos on villa_promos for all to service_role using (true) with check (true);

drop policy if exists srole_villa_promo_batches on villa_promo_batches;
create policy srole_villa_promo_batches on villa_promo_batches for all to service_role using (true) with check (true);

drop policy if exists srole_villa_promo_sends on villa_promo_sends;
create policy srole_villa_promo_sends on villa_promo_sends for all to service_role using (true) with check (true);

drop policy if exists srole_villa_promo_redemptions on villa_promo_redemptions;
create policy srole_villa_promo_redemptions on villa_promo_redemptions for all to service_role using (true) with check (true);

-- Sabuk kedua di samping RLS: cabut grant bawaan supaya pemegang anon key
-- tidak bisa menyentuh tabel-tabel ini sama sekali, bukan cuma dapat nol
-- baris. Isinya nomor HP dan email tamu.
revoke all on villa_guest_marketing, villa_promos, villa_promo_batches, villa_promo_sends, villa_promo_redemptions from anon, authenticated;
revoke all on villa_guest_directory from anon, authenticated;
