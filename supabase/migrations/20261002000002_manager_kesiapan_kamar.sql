-- Role manager + checklist kesiapan kamar, disetujui owner 2026-10-02.
--
-- Permintaan owner: role login baru "manager" (Rebecca) yang hanya melihat
-- satu modul -- checklist kesiapan kamar (kebersihan, bathroom, linen,
-- gorden, AC, TV, kebersihan kolam, air bersih, pembuangan air, lampu) --
-- dengan dua tombol: "Kamar Siap" dan "Kamar Maintenance".
--
-- Keputusan owner yang membentuk skema ini (2026-10-02):
--   "saat ini kamar otomatis terbuka kan, biarkan seperti itu, jika manager
--    melihat ada kerusakan maka dia bisa menutup kamar, tp jika dia rasa
--    kamar siap maka itu memicu kamar ttp ready dijual"
--
-- Jadi KEADAAN BAWAAN = TERBUKA. Tidak ada baris di villa_room_maintenance
-- berarti kamar dijual seperti biasa. Hanya tombol "Kamar Maintenance" yang
-- membuat baris (dan room block out_of_service di Cloudbeds); "Kamar Siap"
-- menghapusnya. Tidak ada yang menutup kamar secara otomatis.
--
-- units.status SENGAJA tidak dipakai: kolom itu ditulis ulang oleh alur
-- check-in/checkout (occupied/dirty/available), sehingga tanda maintenance
-- di sana akan tertimpa diam-diam oleh checkout berikutnya.
--
-- RLS mengikuti pola pengerasan 2026-09-08: RLS ON, satu policy
-- service_role. Semua akses lewat villa-api.

-- ── 1. role baru ─────────────────────────────────────────────────────────
-- Daftar lama dibaca langsung dari database 2026-10-02 (bukan dari ingatan):
-- owner, receptionist, admin, security, cleaning_service, finance.
alter table villa_users drop constraint if exists villa_users_role_check;
alter table villa_users add constraint villa_users_role_check
  check (role = any (array['owner','receptionist','admin','security','cleaning_service','finance','manager']));

-- ── 2. keadaan sekarang: kamar yang sedang ditutup ───────────────────────
create table if not exists villa_room_maintenance (
  unit_id uuid primary key references units(id) on delete cascade,
  -- Malam pertama dan malam TERAKHIR yang ditutup (keduanya ikut ditutup).
  tutup_mulai date not null,
  tutup_sampai date not null,
  alasan text not null,
  cloudbeds_room_block_id text not null,
  ditutup_oleh uuid references villa_users(id) on delete set null,
  ditutup_oleh_nama text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint villa_room_maintenance_rentang check (tutup_sampai >= tutup_mulai)
);

-- ── 3. riwayat setiap pengecekan ─────────────────────────────────────────
create table if not exists villa_room_checks (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  unit_nomor text,
  hasil text not null,
  -- {"kebersihan":true,"bathroom":false,...} -- 10 poin, true = baik.
  checklist jsonb not null,
  catatan text,
  tutup_mulai date,
  tutup_sampai date,
  -- Apa yang terjadi di Cloudbeds karena pengecekan ini:
  --   ditutup / diperpanjang / dibuka = berhasil;
  --   tidak_perlu = "Kamar Siap" pada kamar yang memang sudah terbuka;
  --   gagal = Cloudbeds menolak, keadaan kamar TIDAK berubah.
  cloudbeds_aksi text not null,
  cloudbeds_room_block_id text,
  cloudbeds_pesan text,
  dicek_oleh uuid references villa_users(id) on delete set null,
  dicek_oleh_nama text,
  created_at timestamptz not null default now(),

  constraint villa_room_checks_hasil check (hasil in ('siap','maintenance')),
  constraint villa_room_checks_aksi check (cloudbeds_aksi in ('ditutup','diperpanjang','dibuka','tidak_perlu','gagal'))
);

create index if not exists villa_room_checks_unit_idx on villa_room_checks (unit_id, created_at desc);

alter table villa_room_maintenance enable row level security;
alter table villa_room_checks enable row level security;

drop policy if exists srole_villa_room_maintenance on villa_room_maintenance;
create policy srole_villa_room_maintenance on villa_room_maintenance for all to service_role using (true) with check (true);

drop policy if exists srole_villa_room_checks on villa_room_checks;
create policy srole_villa_room_checks on villa_room_checks for all to service_role using (true) with check (true);
