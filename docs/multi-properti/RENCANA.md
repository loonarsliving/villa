# Rencana: satu sistem multi-properti (Private Living + Excellent Living)

Keputusan owner 2026-11-03: Excellent Living (EL) dibuat **selengkap Private
Living (PL)** dengan pilihan **B: satu sistem multi-properti**. Tabel
booking/kamar/finance yang sama diberi kolom properti, sehingga semua fitur
berlaku untuk kedua properti. Admin dan finance memakai akun yang sama untuk
kedua properti. Yang dibedakan per properti hanya **manager** dan
**resepsionis** ("yg beda nanti hanya login manager dan recptionis").

Ini menggantikan keputusan 2026-10-22 ("benar2 tabel baru yg lain"). Tabel
`el_*` dipindahkan ke tabel inti di Tahap 4.

## Kenapa butuh tahapan dan persetujuan per tahap

Tabel inti dipakai rumus uang PL: bagi hasil/dividen investor (`computeReport`),
laporan mingguan investor, Survival KPI, Finance (pendapatan, komisi OTA,
checklist dana, tutup buku), harga AI, dan okupansi. Rumus-rumus ini
menghitung **semua** baris `units`/`bookings` (contoh: `count(units)` = jumlah
kamar). Satu kamar EL saja yang masuk ke `units` tanpa saringan properti akan
mengubah angka dividen investor PL. Karena itu urutannya:
saringan dipasang dulu → dibuktikan angka PL tidak berubah → baru data EL
masuk.

Skala (dihitung 2026-11-03): villa-api memuat 76 query `bookings`, 26 `units`,
17 `guests`, 10 `cloudbeds_room_mapping`, dan src memuat ±50 query. Semua
query itu harus diperiksa.

## Tahap

### Tahap 1: Fondasi database (aditif, perilaku PL tidak berubah) — SELESAI 2026-11-04
Migrasi baru, butuh persetujuan owner:
- Tabel `villa_properties` (`kode` 'PL' / 'EL', nama, awalan env Cloudbeds,
  aktif).
- Kolom `property_kode text not null default 'PL'` (FK ke
  `villa_properties`) di `units`, `villa_room_types`, `bookings`,
  `cloudbeds_room_mapping`, `cloudbeds_events_log`, `transactions`,
  `finance_settlements`, `notifications`, `wa_messages_log`,
  `housekeeping`, `villa_room_checks`, `villa_room_maintenance`,
  `villa_pengajuan_biaya`, `villa_daily_inventory_snapshot`, `villa_promos`,
  `finance_tutup_buku` (unik menjadi `(periode, property_kode)`).
  `villa_rates` mengikuti `villa_room_types`.
- `villa_users.property_kode` (null = semua properti; diisi 'EL' untuk
  manager/resepsionis EL). Persetujuan owner atas "role el_manager" dipenuhi
  dengan cara ini: manager EL = role `manager` + `property_kode='EL'`.
  Begitu juga resepsionis (`receptionist` + 'EL'). Role `el_receptionist`
  dipertahankan sampai Tahap 4.
- `guests` tetap bersama (satu tamu bisa menginap di kedua properti).
- Semua baris lama otomatis 'PL' lewat default.
- Ditambah pengaman (owner 2026-11-04 "buat sj pgaman"): koneksi database
  villa-api dan Next.js dibungkus `klienProperti` sehingga tabel inti
  otomatis disaring ke 'PL'. Dengan pengaman ini, langkah "kunci rumus uang
  PL" di Tahap 2 sudah terpenuhi untuk semua kode lama. Tabel yang tercakup
  untuk sementara baru 7 tabel inti (lihat DATABASE.md); tabel lain di
  daftar atas ditambahkan saat dibutuhkan.

### Tahap 2: Saringan properti di villa-api dan src (PL tetap identik)
- Setiap query `units`/`bookings`/finance memakai properti dari sesi:
  manager/resepsionis = properti akunnya; admin/finance = properti yang
  dipilih di pemilih properti (bawaan PL).
- Rumus uang PL (`computeReport`, `pendapatanBersih`, `/finance/*`,
  `/bridge/owner-finance`, laporan investor, Survival, mesin harga AI) dikunci
  ke properti yang diminta. Untuk EL hanya berjalan setelah owner menetapkan
  rumusnya.
- **Bukti wajib sebelum merge:** angka PL dari endpoint uang (laporan dividen
  Sep & Okt per unit, `/finance/summary`, `/finance/survival`,
  `/finance/checklist-dana`, laporan mingguan investor) direkam sebelum dan
  sesudah perubahan, dan harus **sama persis**.

### Tahap 3: Cloudbeds per properti
- Kredensial per properti (PL: `CLOUDBEDS_*`, EL:
  `CLOUDBEDS_API_KEY_LOONARS2`).
- Sinkron reservasi, kirim booking, pemetaan kamar otomatis, dan baca harga
  memakai jalur PL yang sama per properti. Sinkron EL di
  `elCloudbedsSync.ts` dilebur ke situ.
- Harga AI dan push harga ke Cloudbeds untuk EL tetap **mati** sampai owner
  menyalakannya (menyangkut uang).

### Tahap 4: Pindahkan data EL dan pensiunkan `el_*`
- `el_room_types` → `villa_room_types`, `el_rooms` → `units`, `el_bookings` →
  `bookings`, `el_housekeeping` → `housekeeping`, pemetaan Cloudbeds EL →
  `cloudbeds_room_mapping` (semua `property_kode='EL'`). Data per 2026-11-03:
  4 kamar, 0 booking.
- Halaman `/excellent/*` dialihkan ke halaman bersama dengan properti EL.
  Tabel `el_*` dibiarkan (tidak dihapus) sampai owner setuju.

### Tahap 5: Semua fitur PL aktif untuk EL
Front desk (chat WA, kasir/QRIS, notifikasi, amenities/BBQ, housekeeping,
siteplan), manager (kesiapan kamar, buka/tutup kamar, pengajuan biaya, chat,
CCTV), admin (laporan, tamu, log WA, promo, akun staf, harga), finance
(pendapatan + komisi OTA, checklist dana, laba rugi, tutup buku, rencana kas),
loonars.id (booking EL + QRIS, saat owner membuka EL).

### Tahap 6: Uang khusus EL (butuh keputusan owner)
Rumus bagi hasil investor EL, COGS/OPEX EL, harga website EL, dan AI pricing
EL. Masing-masing dijelaskan ke owner dulu, lalu dikerjakan setelah owner
setuju.

## Yang tetap seperti sekarang selama tahapan
- Sinkron Cloudbeds EL, pemetaan kamar otomatis, buka/tutup kamar oleh manager
  villa, dan harga EL dari Cloudbeds (2026-11-03) tetap berjalan di tabel
  `el_*` sampai Tahap 4.

## Progres Tahap 4 (2026-11-04)
- SELESAI: konteks properti per request di villa-api (#267, `PROPERTI_SIAP` masih hanya PL); fungsi database MK Connect disaring PL (Mkhsistem 0313/0314); check-in mencatat properti booking; `units.blok` A/B/C hanya untuk PL; kamar EL = 31 kamar / 4 tipe (tipe dari Cloudbeds, kamar diatur di sistem).
- Temuan yang menentukan urutan berikutnya: banyak fitur PL punya efek khusus PL -- WA bertuliskan Private Living + PIN pintu saat check-in, QRIS kasir (`walkin_qris`) rekening PL, harga booking dari `villa_rates` PL, notifikasi & riwayat cek kamar tanpa kolom properti, rumus uang dengan konstanta PL (COGS, gaji, 70/30, jaminan). Karena itu EL dibuka dengan DAFTAR IZIN rute di villa-api: dalam konteks non-PL hanya rute yang sudah diperiksa yang boleh, `sendWa` hanya template EL, sisanya "belum aktif untuk properti ini".
- BERIKUTNYA: (a) pengaman villa-api (daftar izin + sendWa + tanpa PIN); (b) pindahkan 31 kamar + 4 tipe + pemetaan EL ke `units`/`villa_room_types`/`cloudbeds_room_mapping` dan sinkron Cloudbeds EL menulis ke tabel bersama; (c) `PROPERTI_SIAP` + EL, header `x-villa-property`, menu EL = halaman yang sudah diizinkan; (d) fitur berikutnya dibuka satu per satu setelah diperiksa.
