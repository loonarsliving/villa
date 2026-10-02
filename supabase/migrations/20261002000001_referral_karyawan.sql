-- Kode referral karyawan, disetujui owner 2026-10-02.
--
-- Permintaan owner: "buatkan diskon referall sebesar 10% ... kode itu di
-- tampilkan di dashboard vando di mkhsistem ... vando jga bisa menambah
-- kode, dan bisa mengirimkan ke karyawan kodenya pakai fitur wa ...
-- tujuannya agar pegawai bisa memakai itu jika mereka menjualnya bisa dpt
-- feenya ... buatkan tabel di finance villa ... kode referal ini bisa
-- dipakai di halaman loonars".
--
-- Keputusan owner yang membentuk skema ini (dijawab 2026-10-02):
--
-- 1. "10%" itu FEE, BUKAN diskon: "diskon 10% itu fungsinya agar 10% itu
--    masuk ke fee, tp harga yg ditrima tamu ttp normal". Tamu membayar harga
--    normal; kode hanya menandai karyawan mana yang membawa tamu itu.
--    Karena itu harga tamu TIDAK disentuh sama sekali oleh referral.
-- 2. Fee karyawan = 10% dari nilai booking (harga normal, tanpa kode unik
--    pembayaran). Disimpan sebagai angka rupiah per pemakaian, bukan
--    dihitung ulang belakangan, supaya perubahan persen di kemudian hari
--    tidak diam-diam mengubah fee yang sudah dijanjikan.
-- 3. Fee baru SAH setelah tamu lunas. Status itu TIDAK disimpan di sini:
--    diturunkan dari bookings.status saat dibaca (terjadwal/checkin/
--    checkout = lunas, batal = gugur), supaya tidak ada dua sumber
--    kebenaran yang bisa tidak sinkron dengan alur pembayaran.
-- 4. Hanya untuk booking lewat loonars.id (jalur /public/bookings).
--
-- Kode dibuat dari Mkhsistem (dashboard Vando / perintah WA "REFERAL
-- <nama>") lewat jembatan villa-api, jadi karyawan dirujuk ke `employees`
-- Mkhsistem -- satu database yang sama. Nama karyawan ikut disalin supaya
-- laporan fee tetap terbaca meski data karyawan berubah atau terhapus.
--
-- RLS mengikuti pola pengerasan 2026-09-08: RLS ON, satu policy
-- service_role. Semua akses lewat villa-api.

-- ── 1. kode referral ─────────────────────────────────────────────────────
create table if not exists villa_referral_codes (
  id uuid primary key default gen_random_uuid(),
  -- Selalu berawalan "REF-" (dijaga villa-api). Tanda hubung membuatnya
  -- tidak mungkin tertukar dengan kode menginap gratis investor, yang
  -- formatnya persis 8 huruf/angka tanpa tanda baca.
  kode text not null unique,
  employee_id uuid references employees(id) on delete set null,
  employee_nama text not null,
  fee_persen numeric not null default 10,
  aktif boolean not null default true,
  catatan text,
  dibuat_oleh text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint villa_referral_codes_kode_format check (kode ~ '^REF-[A-Z0-9]{2,20}$'),
  constraint villa_referral_codes_persen_wajar check (fee_persen > 0 and fee_persen <= 50)
);

create index if not exists villa_referral_codes_employee_idx on villa_referral_codes (employee_id);

-- ── 2. pemakaian kode = calon fee karyawan ───────────────────────────────
create table if not exists villa_referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references villa_referral_codes(id) on delete restrict,
  kode text not null,
  employee_id uuid,
  employee_nama text not null,
  -- set null, bukan cascade: catatan fee tidak boleh hilang diam-diam.
  -- Booking yang hilang dibaca sebagai gugur (lihat villa-api).
  booking_id uuid references bookings(id) on delete set null,
  guest_nama text,
  tgl_checkin date,
  tgl_checkout date,
  malam integer,
  -- Nilai booking = yang ditagih ke tamu (harga normal), tanpa kode unik.
  nilai_booking numeric not null,
  fee_persen numeric not null,
  fee numeric not null,
  -- Pencairan fee ke karyawan, diisi Finance.
  fee_dibayar_at timestamptz,
  fee_dibayar_oleh text,
  created_at timestamptz not null default now(),

  constraint villa_referral_redemptions_angka_wajar check (
    nilai_booking >= 0 and fee >= 0
  )
);

-- Satu booking hanya bisa membawa satu kode referral.
create unique index if not exists villa_referral_redemptions_booking_unik
  on villa_referral_redemptions (booking_id) where booking_id is not null;
create index if not exists villa_referral_redemptions_code_idx on villa_referral_redemptions (referral_code_id);
create index if not exists villa_referral_redemptions_employee_idx on villa_referral_redemptions (employee_id);

-- ── 3. RLS ───────────────────────────────────────────────────────────────
alter table villa_referral_codes enable row level security;
alter table villa_referral_redemptions enable row level security;

drop policy if exists srole_villa_referral_codes on villa_referral_codes;
create policy srole_villa_referral_codes on villa_referral_codes for all to service_role using (true) with check (true);

drop policy if exists srole_villa_referral_redemptions on villa_referral_redemptions;
create policy srole_villa_referral_redemptions on villa_referral_redemptions for all to service_role using (true) with check (true);
