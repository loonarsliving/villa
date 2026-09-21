# CURRENT_STATE.md

_Snapshot as of this audit: 2026-08-21, `main`@`ab473b3`._

## 2026-09-21 — kasir (Payment Gateway) dan loonars.id disatukan sumber harganya

Owner bertanya kenapa harga di sistem kasir berbeda dengan loonars.id.
Root cause (dibaca langsung dari kode, bukan tebakan): **loonars.id**
(`/public/bookings`, `/public/availability`) sudah lama memakai
`computeStayTarif()` di `villa-api`, yang mengambil harga dinamis per
tanggal dari `villa_rates` (hasil mesin harga AI) kalau ada, baru jatuh
ke `units.tarif_harian` flat kalau tidak. **Layar kasir** (`/front-desk/
payment-gateway`) sebaliknya menghitung sendiri di browser pakai
`tarif_harian` flat × jumlah malam — tidak pernah menanyakan
`villa_rates` — jadi setiap kali mesin harga AI sedang menetapkan harga
berbeda dari flat rate untuk tanggal itu (weekend surcharge, high/low
season), angka di layar kasir bisa beda dari loonars.id, dan bahkan dari
nominal yang akhirnya tercatat (karena `POST /bookings` staf memang
sudah menghitung ulang di server dengan logika yang sama seperti
loonars.id -- yang beda cuma tampilan di layar kasir SEBELUM booking
dibuat).

**Diperbaiki (branch `claude/kasir-loonars-price-diff-tn923p`,
owner-approved di chat 2026-09-21 -- ini soal harga tamu, jadi tidak
di-merge sendiri tanpa itu):**
- Route baru staf-only `GET /tarif-preview` di villa-api, memanggil
  `computeStayTarif()` yang SAMA dipakai `/public/bookings` -- kasir
  sekarang menanyakan harga real-time ke server, bukan menghitung
  sendiri.
- `POST /bookings` (jalur kasir) yang tadinya menyalin ulang logika
  `villa_rates`-lookup-nya sendiri (kode duplikat, berisiko menyimpang
  dari `computeStayTarif` suatu saat) sekarang memanggil fungsi yang
  sama juga -- tiga jalur (`/tarif-preview`, `POST /bookings`,
  `/public/bookings`) sekarang satu fungsi harga, bukan tiga salinan.
- `payment-gateway/page.tsx` memanggil `/tarif-preview` setiap kali
  unit/tanggal/tipe berubah dan menampilkan angka itu ("Harga sistem
  saat ini — sama dengan loonars.id"), dengan fallback ke perkiraan
  flat (dilabeli jelas sebagai perkiraan) kalau panggilan itu gagal.

**Belum aktif sampai di-deploy:** perubahan `villa-api` di repo ini
hanya snapshot -- baru live setelah branch ini di-merge ke `main` DAN
`deploy-villa-api.yml` berhasil. Per catatan 2026-09-20 di atas,
`SUPABASE_ACCESS_TOKEN` (GitHub secret) sedang kedaluwarsa sehingga
workflow itu gagal 401 -- **wajib dicek ulang setelah merge** (Actions
hijau + versi fungsi naik di `mcp__Supabase__list_edge_functions`)
sebelum menganggap perbaikan ini benar-benar berlaku di produksi. Kalau
token belum diperbaiki, `/tarif-preview` akan 404 di produksi dan kasir
otomatis kembali ke perkiraan flat lama (aman, tidak crash, tapi
perbaikannya belum jalan).

**Diverifikasi sebelum push:** `npx tsc --noEmit` bersih, `npm test`
70/70 hijau, `npm run build` sukses. `npm run lint` tidak bisa
dijalankan non-interaktif di sesi ini (`next lint` meminta pemilihan
konfigurasi ESLint interaktif -- repo ini memang belum punya
`.eslintrc`/`eslint.config.*`, bukan regresi dari perubahan ini).

## 2026-09-20 — Finance dashboard (`/finance`) built, on branch, NOT merged/deployed yet

Owner requested a dedicated Finance dashboard answering 5 questions
(revenue, payment received, outstanding, settlement, cash actually in the
bank). Built on branch `claude/loonars-finance-dashboard-wq1oha`, **not
merged to `main`** — owner explicitly approved the schema/architecture
decisions below via AskUserQuestion, but merge itself is a separate gate
this session did not take (schema changes require owner sign-off on the
PR, per MERGE AUTHORITY in this file's parent CLAUDE.md).

**Audit finding that shaped the design:** Cloudbeds' API, as actually
used by this integration (`getReservationsWithRateDetails`), only ever
supplies a reservation grand total — there is no separate
payment/refund/settlement/payout endpoint available to this key. No
`payments`, `refunds`, `settlements`, or `bank_transactions` table
existed anywhere in the schema before this work; `bookings` had only one
Cloudbeds ID column (`cloudbeds_reservation_id`).

**Schema added** (owner-approved 2026-09-20, migration
`finance_dashboard_schema`): `finance_ota_settlement_config` (per-channel
collection method / settlement delay / destination account, admin-only
write), `finance_settlements` (one row per booking: expected settlement
date + confidence, settlement status, amount received, bank reference,
reconciliation status/variance), `finance_audit_log` (every manual
Finance change). `villa_users_role_check` extended with a new `'finance'`
role (owner-approved instead of reusing `admin`).

**villa-api additions** (in the repo's snapshot,
`supabase/functions/villa-api/index.ts` — **not yet deployed**, see
below): `calculateExpectedSettlement()` only ever returns
`confidence:'CONFIGURED'` when an admin has actually entered a
`settlement_delay_days` rule for that channel in
`finance_ota_settlement_config` — never a hardcoded "Booking.com = 7
hari" guess. Routes: `/finance/summary`, `/finance/channel-breakdown`,
`/finance/bookings`(+`/finance/booking` detail), `/finance/ota-settlement-config`
(GET for finance+admin, POST/DELETE admin-only), `/finance/settlements/process`,
`/finance/settlements/receive`, `/finance/audit-log`, `/finance/whoami`.

**Known, stated (not hidden) data limitations** — every one of these is
surfaced in the dashboard itself, never silently assumed:
- Gross revenue = Net revenue (no itemized room/extras/tax/fee or
  discount/refund feed from Cloudbeds for this key).
- "Payment received" vs "outstanding" is inferred from booking workflow
  status (`checkin`/`checkout` = paid, per the existing "Tandai
  Lunas"-before-check-in rule), **not** a Cloudbeds payment feed — stated
  explicitly in the API response, not presented as authoritative.
- "Cash Received" only ever shows a real figure once Finance staff
  manually mark a settlement RECEIVED with a bank reference; otherwise it
  reads **NOT VERIFIED**, exactly per the mandate ("Jangan menyamakan
  Cloudbeds Payment = Bank Cash").
- Cloudbeds-balance-vs-calculated-balance mismatch detection and refund
  tracking are marked **NOT_AVAILABLE** in every summary response — this
  integration does not sync a separate balance/refund field to compare
  against.

**NOT done yet, needs the PR merged + explicit deploy first:**
1. PR not opened/merged (branch pushed only, per this session's
   instructions not to merge/PR without being asked).
2. Even once merged, villa-api will **not** auto-update: per the
   2026-09-20 entry above, `deploy-villa-api.yml` is currently failing
   (`SUPABASE_ACCESS_TOKEN` expired) — the Finance routes exist in the
   repo's snapshot but are **not live** on the Supabase Edge Function
   until that token is fixed and the workflow re-run.
3. No `finance`-role user exists yet — an admin must create one via
   Admin → Pengguna (role dropdown now includes "Finance").
4. `finance_ota_settlement_config` is empty — every channel will show
   settlement confidence `UNKNOWN` until an admin fills in real delay
   days per OTA contract via `/finance/settlement-config`.

## 2026-09-20 — branch check-in/QRIS/WIB di-merge; villa-api GAGAL ter-deploy

Owner menyetujui merge seluruhnya ("Smua perbaikan langsung merge untuk apa
km simpan2"). PR #92 di-merge ke `main`.

**Frontend: BERHASIL.** Vercel `dpl_CsJEhgQxcdQ5uugCDZ7qXGZVJN9u`, state
READY, commit `c030a4a`. Semua perbaikan check-in, QRIS statis, dan tampilan
WIB sudah live.

**villa-api: GAGAL.** Workflow `deploy-villa-api.yml` berhenti di
`401 Unauthorized` — `SUPABASE_ACCESS_TOKEN` (GitHub repo secret) sudah tidak
berlaku. Live masih **v67** (14 Sep). Lihat DEPLOYMENT.md untuk cara
memperbaikinya; token itu hanya bisa diganti owner.

**Tidak ada yang rusak karenanya, dan ini diperiksa bukan diasumsikan:**
seluruh endpoint villa-api yang dipanggil frontend baru (`/bookings`,
`/checkin`, `/checkout`, `/summary`, `/units`, `/availability`,
`/housekeeping`, `/notifications`, `/walkin-payments`, `/walkin-qris`) ada di
v67. Frontend baru juga berhenti mengirim `tarif`/`total_bayar` pada
`POST /bookings` — v67 memang sudah mengabaikannya dan menghitung sendiri.

**Yang belum aktif sampai villa-api ter-deploy:** 19 turunan "hari
ini"/"bulan ini" di villa-api masih memakai UTC, jadi default periode
`/report`, `/admin/overview`, `/opex`, serta `/summary` dan `/housekeeping`
masih menjawab tanggal/bulan kemarin selama 00:00–07:00 WIB. Frontend sudah
mengirim tanggal WIB secara eksplisit di hampir semua pemanggilan, jadi
dampaknya sempit — tapi belum tertutup.

Fungsi database (`villa_commit_checkin`, `villa_commit_checkout`) TIDAK
terpengaruh: keduanya sudah WIB sejak 19 Sep, diterapkan langsung lewat
migrasi, bukan lewat workflow ini.

## 2026-09-20 — audit ulang alur check-in

Owner minta dipastikan tidak ada bug lagi di proses check-in. Ditelusuri
ulang: `/front-desk` → CheckinCard → `POST /checkin` → `villa_commit_checkin`,
plus jalur walk-in lewat Payment Gateway.

### Bug baru yang ditemukan — dan ini bug yang SAYA perkenalkan sendiri

`fitCanvas` dipasang sebagai listener `resize`, dan di dalamnya
`canvas.width = ...` — menyetel ukuran buffer kanvas MENGOSONGKAN kanvas.
Di HP, `resize` terpicu saat keyboard virtual muncul/hilang, saat bilah URL
menyusut ketika modal di-scroll, dan saat layar diputar — semuanya bisa
terjadi SETELAH tamu menandatangani. Goresannya terhapus sementara
`hasSignature` tetap `true`, jadi penjagaannya lolos dan yang tersimpan
sebagai bukti persetujuan tata tertib adalah **gambar kosong** — padahal
tanda tangan itu dasar penagihan denda merokok Rp500.000 dan ganti rugi.

**Dibuktikan di Chromium sungguhan (Playwright), bukan dinalar:**
menandatangani lalu mengecilkan viewport → kode lama piksel tinta
1658 → **0**; kode baru 1057 → **1057**.

Pelajarannya: memperbaiki kanvas agar responsif (perbaikan koordinat pena
19 Sep) sekaligus membuka lubang baru di fitur yang sama. Perbaikan pada
kanvas HARUS diuji di browser, karena tidak ada satu pun tes Node yang bisa
menangkapnya.

Dua hal ikut ketahuan dari pengujian yang sama:
- **Latar tanda tangan transparan** (56.000 piksel transparan). `bg-white`
  cuma kelas CSS; `toDataURL` hanya mengambil isi kanvas. Tinta hitam di
  atas latar transparan tidak akan terbaca di atas latar gelap. Sekarang
  putihnya ditulis ke dalam kanvas.
- **Foto KTP terunggah ulang** setiap kali check-in gagal lalu diulang —
  salinan KTP menganggur menumpuk di storage. Sekarang dipakai ulang.

### Temuan yang BELUM ditangani: KTP & tanda tangan tidak bisa dilihat kembali

Foto KTP diunggah ke bucket privat `guest-documents`, path-nya disimpan di
`bookings.ktp_photo_path`, dan tanda tangan di `bookings.signature_data_url`.
**Tidak ada satu pun endpoint maupun halaman yang membacanya kembali** —
diperiksa di seluruh `src/` dan villa-api. Jadi seluruh proses ambil KTP +
tanda tangan saat ini bersifat sekali tulis: datanya dikumpulkan, tapi tidak
pernah bisa dipakai saat sengketa (denda merokok, kerusakan, keterlambatan
check-out) — yang justru satu-satunya alasan mengumpulkannya. Sementara itu
villa tetap menanggung risiko menyimpan data pribadi tamu.

Perlu keputusan owner: bikin penampil khusus staf (signed URL berumur
pendek, digerbang role), dan sekalian tentukan berapa lama dokumen ini
disimpan.

### Fakta penting: alur ini BELUM PERNAH dipakai sungguhan

`bookings` hanya punya **satu** check-in yang pernah terjadi (28 Agu), dan
baris itu `ktp_photo_path` dan `signature_data_url`-nya NULL — dibuat
sebelum CheckinCard ada. Artinya seluruh rangkaian KTP + tanda tangan belum
pernah dijalankan di produksi sekali pun. Bug-bug di atas (kanvas melenceng,
foto terlalu besar, KTP tamu salah, tanda tangan terhapus) semuanya akan
muncul pada check-in sungguhan yang PERTAMA.

### Yang diperiksa dan ternyata BUKAN bug

- `sendWa()` tidak pernah melempar error — semua kegagalan ditangkap dan
  dicatat ke `wa_messages_log`, lalu mengembalikan `false`. Jadi WA yang
  gagal terkirim TIDAK membuat check-in yang sudah tercatat dilaporkan
  gagal ke resepsionis.
- Booking website yang belum dibayar berstatus `menunggu_pembayaran`,
  tidak muncul di `/bookings?status=terjadwal`, dan `villa_commit_checkin`
  juga menolaknya. Tidak bisa check-in tanpa bayar.
- Check-in ganda terkunci benar di database (`select ... for update` lalu
  cek status di dalam RPC).

### Perbaikan kalender dari `main` (#91) sudah digabung ke branch ini

Konfliknya diselesaikan dengan mempertahankan `addDaysISO` (helper bersama
yang ada tesnya) sambil mengambil perbaikan `dayIndex` versi UTC dari main.

## 2026-09-19 (lanjutan 2) — WIB ditutup sampai ke database dan villa-api

Owner menyetujui perbaikan yang sebelumnya ditahan ("Ya perbaiki"). Sekarang
seluruh rantainya memakai kalender WIB, bukan hanya tampilan frontend.

### Database — SUDAH diterapkan ke produksi

Migrasi `villa_checkin_checkout_wib_dates` (lewat Supabase MCP; repo ini
memang tidak punya `supabase/migrations`, lihat DEVELOPMENT_WORKFLOW.md).
Dua ekspresi yang diubah, tidak lebih:

- `villa_commit_checkin`: `to_char(now(), 'YYYY-MM')` →
  `to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM')` untuk
  `transactions.periode_bulan`.
- `villa_commit_checkout`: `current_date` →
  `(now() at time zone 'Asia/Jakarta')::date` untuk `housekeeping.tgl`.

`checkin_at`/`checkout_at` sengaja TETAP `now()` — keduanya `timestamptz`,
menyimpan titik waktu absolut memang benar, dan frontend sudah
menampilkannya dalam WIB.

**Tidak ada data lama yang rusak, dan ini diperiksa, bukan diasumsikan:**
tidak ada satu pun baris `transactions` yang `periode_bulan`-nya berbeda dari
bulan WIB `created_at`-nya, dan satu-satunya baris `housekeeping` hasil
checkout sungguhan (A5, 28 Agu 13:45 WIB) tanggalnya sudah benar. Dua baris
housekeeping lain yang tanggalnya berbeda adalah data uji bertanggal Desember,
bukan korban bug ini.

**Cakupannya diperiksa dulu:** project Supabase ini dipakai bersama
Mkhsistem (ada ratusan fungsi `crm_*`, `hr_*`, `cm_*`, `construction_*`,
`kpi_*`, `loonars_*`). Dari seluruh fungsi `villa_*`, hanya dua di atas yang
menyentuh tanggal. Tidak ada fungsi milik sistem lain yang disentuh.

### villa-api — ada di branch, BARU AKTIF SETELAH MERGE ke `main`

Ditambahkan `todayWIB()` / `monthWIB()` / `prevMonthWIB()` di atas file, lalu
19 turunan "hari ini"/"bulan ini" dipindahkan ke sana. Edge Function ini
berjalan di UTC, jadi sebelumnya `new Date().toISOString()` menjawab
tanggal/bulan KEMARIN selama 00:00–07:00 WIB. Yang terkena:

- default periode `/report`, `/report/ota-breakdown`, `/admin/overview`,
  `/admin/dividends`, `/opex` (GET dan POST) — laporan bagi hasil investor;
- `/summary` dan `/housekeeping` — tugas "hari ini" resepsionis;
- `/dashboard/hari-ini`, `/cron/laporan-harian`;
- masa berlaku voucher menginap investor dan tanggal berlakunya promo;
- nomor invoice (`INV-LV-<ymd>-…`). Aman diubah karena nomornya dihitung
  sekali lalu DISIMPAN di `bookings.invoice_no` — invoice yang sudah terbit
  tidak pernah dinomori ulang, hanya yang baru.

`/cron/sync-mkh-income` (periode "bulan lalu") juga dipindahkan, tapi
**bukan karena sedang rusak**: cron-nya `15 1 1 * *` UTC = 08:15 WIB, di luar
jendela 00:00–07:00, jadi selama ini hasilnya kebetulan benar. Sekarang tidak
lagi bergantung pada kebetulan itu.

Kolom `timestamptz` (`paid_at`, `sent_at`, `bukti_pembayaran_at`, dst.) tetap
`new Date().toISOString()` — sengaja.

**Penting:** `supabase/functions/villa-api/index.ts` di repo sekarang BERBEDA
dari v67 yang live. Deploy terjadi lewat `.github/workflows/deploy-villa-api.yml`
saat branch ini di-merge ke `main`, bukan sekarang.

### Label "WITA" di komentar diperbaiki jadi WIB

Mesin harga AI dan snapshot inventori **ternyata sudah benar** — keduanya
memakai `Asia/Jakarta` (`todayJakarta()`, `todayInJakarta()`), dan
`toISOString().slice(0,10)` di sana hanyalah aritmetika UTC murni atas string
tanggal (`${dateStr}T00:00:00Z`), yang memang tidak boleh bergeser. Yang salah
cuma **labelnya**: beberapa komentar menyebut "WITA" (UTC+8) padahal
Asia/Jakarta adalah WIB (UTC+7). Diperbaiki di `cctv-checkpoint` (11:00 WIB),
`dividend-list` (08:00 WIB), `sync-mkh-income` (08:15 WIB),
`investor-bank-reminder` (12:05 WIB), `daily-inventory-snapshot`, dan
villa-api.

Ini bukan kerapian belaka: salah label yang persis sama pernah membuat jam
pada dokumen tata tertib yang DITANDATANGANI TAMU meleset satu jam
(lihat catatan 2026-09-11 dan komentar di `CheckinCard.tsx`) — dan jam itulah
dasar denda keterlambatan check-out.

Sisa penyebutan "WITA" ada di `docs/revenue-engine/PHASE4-DESIGN.md` dan
`PHASE6-DESIGN.md`; keduanya catatan desain bertanggal, sengaja tidak
diubah. Yang benar: cron `55 15 * * *` = 22:55 WIB, dan cron mesin harga di
`vercel.json` sekarang `10 17 * * *` = 00:10 WIB (dokumen itu masih menulis
`10 16 * * *`).

## 2026-09-19 (lanjutan) — iPaymu dihapus, semua jam & tanggal jadi WIB

Dua keputusan owner setelah audit di bawah: *"Saya tidak pakai ipaymu saya
pakai qris statis, dan tolong rubah jdi wib untuk jam dan waktu"*.

### iPaymu dihapus seluruhnya

Dihapus: `src/lib/ipaymuApi.ts`, `/api/payment-gateway/qris`,
`/api/payment-gateway/qris/status`, `/api/webhooks/ipaymu`, dan dependensi
`qrcode`. Kredensialnya memang tidak pernah ada di Vercel dan
`walkin_payments` kosong, jadi tidak ada satu pun transaksi sungguhan yang
pernah melewatinya. Kodenya tetap ada di riwayat git.

Halaman Payment Gateway sekarang **murni QRIS statis**: tidak ada percobaan
membuat QR dinamis, tidak ada tombol "Cek Status", tidak ada lencana status
iPaymu. Yang ditambahkan sebagai gantinya, karena sifat QRIS statis memang
menuntutnya:
- QRIS villa ditampilkan lebih besar (w-64) dengan nominal besar di bawahnya;
- langkah bayar ditulis eksplisit — tamu **mengetik sendiri** nominalnya,
  karena kode statis tidak membawa nominal;
- ditegaskan tidak ada konfirmasi otomatis: **klik "Tandai Lunas" oleh kasir
  itulah catatan pembayarannya**, dan untuk villa klik itu sekaligus
  menjalankan check-in (kirim PIN WA, catat pemasukan bagi hasil, ubah status
  unit);
- peringatan merah di kartu Kasir kalau gambar QRIS belum diunggah — tanpa
  itu seluruh alur kasir mati, dan dulu hal ini hanya terlihat setelah modal
  dibuka.

### Semua jam & tanggal jadi WIB

`src/lib/format.ts` sekarang memaksa `timeZone: "Asia/Jakarta"` di semua
formatter dan memberi label "WIB" pada setiap jam (`fmtDateTime`, `fmtTime`).
Sebelumnya modul ini tidak menyebut zona waktu sama sekali, jadi hasilnya
mengikuti pengaturan perangkat — HP yang zonanya salah atau laptop yang
sedang di luar negeri menampilkan jam berbeda untuk kejadian yang sama,
padahal jam di layar ini dipakai menghitung denda check-out (batas 12:00
WIB).

Tiga bug tanggal yang ikut ketahuan dan diperbaiki — semuanya akibat mencampur
waktu lokal dengan UTC:

1. **`todayISO()`/`currentPeriod()` memakai tanggal UTC.** Antara 00:00–07:00
   WIB keduanya menjawab tanggal/bulan **kemarin**. Resepsionis shift malam
   mendapat tanggal kemarin sebagai nilai bawaan form check-in.
2. **Kalender booking front-desk bergeser satu hari.** `addDays()` mengurai
   tanggal sebagai tengah malam **lokal** lalu menyerialkan ulang lewat
   `toISOString()` (**UTC**). Di WIB, tengah malam 20 Sep = 17:00 UTC 19 Sep,
   sehingga `addDays("2026-09-20", 1)` mengembalikan `"2026-09-20"` lagi —
   seluruh kolom kalender, penanda "Hari Ini", dan rentang yang diminta ke
   villa-api bergeser. Sekarang memakai `addDaysISO` yang murni UTC.
3. **Daftar bulan di laporan investor menunjuk bulan yang salah.**
   `new Date(tahun, bulan - i, 1).toISOString().slice(0,7)` di WIB
   menghasilkan bulan **sebelumnya**, sementara labelnya memakai waktu lokal.
   Jadi label tertulis "September 2026" tapi periode yang diminta ke API
   `2026-08` — investor membaca laporan bulan yang bukan dipilihnya.
   Diganti `recentPeriods()` yang murni aritmetika tahun/bulan.
   **Perhatian: angka di halaman Laporan Bulanan investor akan bergeser ke
   bulan yang benar setelah ini.** Tidak ada formula yang diubah — hanya
   bulan yang diminta.

Ditambah 8 tes baru untuk WIB (total 70 tes hijau).

### Masih memakai UTC dan BELUM diubah — perlu persetujuan owner

Ini di sisi database, bukan frontend, dan menyentuh uang/skema:
- **`villa_commit_checkin` menulis `periode_bulan = to_char(now(),'YYYY-MM')`
  dengan timezone database UTC** (dikonfirmasi: `current_setting('TimeZone')`
  = UTC). Check-in antara 00:00–07:00 WIB pada tanggal 1 akan tercatat di
  **bulan sebelumnya**, sehingga pemasukannya masuk ke laporan bagi hasil
  bulan yang salah.
- **`villa_commit_checkout` memakai `current_date`** untuk `housekeeping.tgl`
  dengan masalah yang sama. Checkout yang diproses 00:00–07:00 WIB membuat
  tugas housekeeping bertanggal kemarin, sehingga tidak muncul di halaman
  Housekeeping yang menanyakan tanggal hari ini. Setelah `todayISO()` jadi
  WIB, tugas seperti itu tidak akan muncul sama sekali (sebelumnya sempat
  muncul selama 6 jam pertama). Jendelanya sempit — butuh checkout diproses
  dini hari — tapi nyata.

Perbaikannya sederhana (`(now() at time zone 'Asia/Jakarta')`), tapi keduanya
mengubah fungsi database yang menyentuh pencatatan pemasukan investor.

## 2026-09-19 — audit halaman resepsionis (check-in + pembayaran QRIS)

Owner minta halaman resepsionis untuk check-in dan pembayaran QRIS diperiksa
sampai tidak ada bug lagi. Yang diperiksa: `/front-desk`,
`/front-desk/payment-gateway`, `CheckinCard`, `/api/checkin/upload-ktp`,
`/api/payment-gateway/qris(+/status)`, `/api/webhooks/ipaymu`, dan
`src/lib/ipaymuApi.ts` — semuanya dicocokkan ke villa-api v67 yang **live**
(diverifikasi lewat Supabase MCP; snapshot di repo identik dengan yang live)
serta ke skema `bookings` dan RPC `villa_commit_checkin/checkout`.

### Temuan terberat: booking 0 malam menembus SEMUA pengaman double-booking

Form kasir villa walk-in memberi nilai bawaan **check-out = check-in**. Itu
menghasilkan `daterange(tgl_checkin, tgl_checkout, '[)')` yang **kosong**, dan
rentang kosong tidak pernah bertabrakan dengan apa pun. Akibatnya booking
seperti itu lolos dari ketiga lapis pengaman sekaligus:

1. exclusion constraint `bookings_no_overlap_active` di database,
2. pengecekan bentrok villa-api (`datesOverlap`) di `POST /bookings`,
3. `GET /availability` yang dipakai dropdown unit di layar kasir.

Artinya resepsionis yang tidak mengubah tanggal bawaan bisa membuat booking
untuk unit yang **sedang terisi**, tanpa satu pun peringatan, dan unit itu
tetap ditagih satu malam (`Math.max(1, ...)` di villa-api). Belum pernah
terjadi di produksi — dicek, tidak ada satu pun baris `bookings` dengan
`tgl_checkout <= tgl_checkin` — tapi keadaan bawaan form memang persis itu.

Diperbaiki di sisi form: bawaan check-out sekarang satu malam (satu bulan
untuk sewa bulanan), rentang divalidasi sebelum booking dibuat, dan tombolnya
terkunci selama rentangnya tidak sah. Logika tanggalnya dipisah ke
`src/lib/stayDates.ts` dengan 9 tes.

**Belum ditutup di lapis bawah, dan ini sengaja:** villa-api dan constraint
database masih menerima rentang kosong dari jalur lain (mis. pemanggil API
langsung). Menutupnya menyentuh skema/constraint, yang butuh persetujuan
owner lebih dulu.

### iPaymu memang BELUM dikonfigurasi di produksi

`IPAYMU_VA` dan `IPAYMU_API_KEY` **tidak ada** di environment variables
Vercel (diperiksa langsung, hanya nama yang dilihat). Jadi setiap pembuatan
QRIS dinamis menjawab 503, dan modal pembayaran diam-diam jatuh ke **QRIS
statis** villa — yang tidak membawa nominal. Kasir tidak punya cara tahu
bedanya: layarnya terlihat normal.

Ini bukan sekadar teori: inilah cara halaman itu berjalan sekarang. Tamu
harus mengetik sendiri nominalnya, dan salah ketik baru ketahuan belakangan.
Modal sekarang menyatakannya terang-terangan (nominal yang harus diketik ikut
ditampilkan), dan "Cek Status" menjelaskan kenapa status otomatis belum bisa
dipakai alih-alih memunculkan galat mentah.

`walkin_payments` masih **kosong sama sekali** — Payment Gateway belum pernah
dipakai untuk transaksi sungguhan.

### Bug lain yang ditemukan dan diperbaiki

- **KTP + tanda tangan bisa menempel ke tamu yang salah.** `capturedKtpSig`
  disimpan tanpa penanda milik siapa. Membuat booking tamu A lalu membuka
  booking tamu B yang masih pending dan menekan "Tandai Lunas & Check-In"
  menyimpan KTP dan tanda tangan **tamu A** ke booking **tamu B** — dokumen
  persetujuan tata tertib jadi milik orang yang salah. Sekarang terikat ke
  `booking_id`; kalau tidak cocok, kartu check-in diminta ulang.
- **Kanvas tanda tangan melenceng.** `width=360/height=140` dipatok sementara
  CSS-nya `w-full`, jadi koordinat pena tidak pernah jatuh di titik yang
  digambar: di HP tanda tangan muncul bergeser dan gepeng, di layar lebar
  ujung kanannya terpotong. Kanvas kini mengikuti ukuran tampilan + DPR.
- **Foto KTP dari kamera HP bisa menembus batas body Vercel (~4,5MB).** Foto
  3–6MB dikirim sebagai data URL base64 (membengkak ~1,37x) ke
  `/api/checkin/upload-ktp`, dan check-in gagal dengan galat yang tidak
  menjelaskan apa pun. Foto sekarang diperkecil di browser (maks 1600px,
  JPEG) sebelum diunggah.
- **Catatan kondisi saat check-out dibuang.** Kolom "Catatan" diisi
  resepsionis lalu tidak pernah dikirim ke mana pun; villa-api hanya menerima
  `kondisi` (disimpan ke `bookings.catatan`). Sekarang digabung ke sana.
- **`load()` Front Desk tanpa penanganan galat** — satu permintaan gagal
  membuat halaman berhenti di "Memuat…" selamanya tanpa pesan apa pun.
  `doCheckout()` juga tanpa `try/catch`: checkout yang gagal tidak
  memunculkan apa pun di layar.
- **Dobel-klik.** Tidak ada satu pun tombol aksi yang terkunci saat aksinya
  berjalan. Sekarang `Btn` punya `disabled`, dipakai di check-in, check-out,
  tandai lunas, dan pembuatan transaksi.
- **Tanggal bawaan memakai UTC.** `todayISO()` mengambil tanggal UTC, jadi
  resepsionis yang bekerja sebelum pukul 07:00 WIB mendapat tanggal
  **kemarin**. Alur check-in kini memakai `todayLocalISO()`.
- **Daftar booking terjadwal diurutkan tanggal pembuatan.** villa-api
  mengembalikan `created_at` menurun dan memotong 50 baris, jadi booking OTA
  lama untuk kedatangan hari ini berada paling bawah. Diurutkan ulang di
  klien berdasarkan tanggal kedatangan + penanda "Hari ini"/"Terlambat" +
  kotak pencarian. Saat ini baru 11 booking `terjadwal`, jadi batas 50 belum
  menggigit — tapi akan menggigit.
- **QRIS dibuat ulang setiap modal dibuka**, padahal tiap `POST
  /payment/direct` membuat transaksi baru di iPaymu dengan `referenceId` yang
  sama. Sekarang di-cache selama halaman terbuka.
- **Webhook iPaymu bisa 500 karena id sampah.** `referenceId` sembarang dari
  internet membuat Postgres menolak query (kolom uuid) → 500 → iPaymu
  mengulang. Sekarang divalidasi sebagai uuid dan diabaikan diam-diam.

### Yang TIDAK diubah dan perlu keputusan owner

- **Sewa bulanan lebih dari satu bulan hanya ditagih satu bulan.** villa-api
  memakai `tarif_bulanan` apa adanya tanpa mengalikan jumlah bulan (berbeda
  dari harian yang dikali malam). Ini perubahan harga, jadi tidak disentuh.
- **Nominal QRIS dikirim dari klien.** `/api/payment-gateway/qris` memakai
  `amount` dari body, bukan membacanya ulang dari booking/transaksi di
  server. Untuk sekarang sumbernya selalu data server, jadi tidak ada
  ketidakcocokan — tapi lapisannya belum ada.
- **`timestamp()` di `ipaymuApi.ts` memakai UTC**, sedangkan pustaka resmi
  iPaymu memakai waktu server (praktiknya WIB). Kalau iPaymu memvalidasi
  jendela waktu, selisih 7 jam akan menolak semua permintaan. Belum bisa
  dipastikan tanpa kredensial sandbox — jangan dianggap benar sampai diuji.
- **Bentuk respons `/payment/direct` masih belum pernah diuji ke iPaymu
  sungguhan** (catatan lama di DEPLOYMENT.md masih berlaku).

## 2026-09-16 — Standard: weekday diturunkan ke Rp550.000, weekend TETAP Rp750.000 (owner-approved)

Owner minta harga weekday Standard diturunkan ke Rp550.000, tapi harga
weekend (Jumat/Sabtu) dipertahankan seperti sekarang (Rp750.000) karena
pemesanan weekend tetap ada. Sawah View tidak disentuh (tetap 750rb
weekday / 850rb weekend).

**Kenapa ini bukan sekadar edit angka:** sebelum perubahan ini, weekend =
anchor (`base_rate`) + `WEEKEND_SURCHARGE` konstanta tunggal Rp100.000
untuk SEMUA tipe unit (`src/lib/aiPricingEngine.ts`). Menurunkan
`base_rate` Standard ke 550rb tanpa mengubah kode akan otomatis
menjatuhkan weekend Standard ke 650rb — bukan yang diminta. Diubah jadi
`WEEKEND_SURCHARGE_BY_ROOM_TYPE_CODE`, per kode tipe unit; Standard
sekarang punya surcharge weekend Rp200.000 (550rb + 200rb = 750rb tetap),
tipe lain tetap pakai default Rp100.000. Ditambah 2 tes baru
(`aiPricingEngine.test.ts`), total 53 tes hijau; `tsc --noEmit` bersih.

**`min_rate` (lantai AI) Standard juga diturunkan** dari Rp600.000 ke
Rp550.000 (owner-approved) — kalau tidak, mesin harga tidak akan pernah
benar-benar menjual di 550rb saat okupansi rendah, karena lantai lama
600rb membenturnya lebih dulu. `max_rate` (1.000.000) tidak disentuh.

**Diubah langsung di `villa_room_types`** (Supabase, bukan lewat
migrasi — tidak ada `supabase/migrations` di repo ini, lihat
DEVELOPMENT_WORKFLOW.md): `code='standard'` → `base_rate=550000,
min_rate=550000`.

**`ai_autopush_enabled` sedang aktif (`true`, sejak 2026-09-11).** Efeknya
langsung nyata di semua OTA pada cron malam berikutnya (`10 17 * * *` UTC
/ 00:10 WIB) lewat `putRate` ke Cloudbeds — bukan dry run. Belum
diverifikasi hasil push malam pertamanya di sesi ini; cek `villa_rates`
(`room_type_id` Standard) atau `villa_rate_history` setelah 00:10 WIB
untuk memastikan tanggal weekday keluar di ~550rb (bisa naik/turun sedikit
kalau ada sinyal permintaan) dan weekend tetap ~750rb.

## 2026-09-15 — label "A4 & A5" Bu Mega diganti, owner menegaskan pemisahannya

Owner menegaskan ulang setelah akun A4/A5 baru dibuat: *"a4&a5 dan
investor trpisah itu 2 hal berbeda, investor trpisah itu masuk di 13
unit, smntra a4&a5 ibu mega itu diluar 13 unit"*.

Strukturnya sudah benar sejak awal (Bu Mega: `unit_id=null`, tidak ada
baris di `villa_investor_units`, pembagi tetap 13). **Yang salah cuma
LABEL**: `villa_users.unit_nomor` Bu Mega masih "A4 & A5", dan
`/admin/investors` mengurutkan berdasarkan `unit_nomor` — jadi daftar
investor menampilkan tiga baris berturut-turut menyebut A4/A5 (unit A4
milik investor baru, "A4 & A5" milik Mega, unit A5 milik investor baru
lain), terlihat seperti unit dobel padahal tidak.

**Diganti jadi `unit_nomor = 'Pemasukan Tetap'`** — tidak menyebut unit
sama sekali, karena dia memang di luar 13 unit. Ikut diperbaiki:
`InvestorShell` menampilkan "Investor Unit {unit_nomor}" untuk semua
investor; untuk yang `unit_id`-nya null sekarang menampilkan "Investor —
{unit_nomor}" supaya tidak terbaca "Investor Unit Pemasukan Tetap".

**Pelajaran:** benar secara struktur data tidak otomatis benar secara
tampilan. Label yang dibiarkan dari sebelum penggabungan akun bisa
membuat sesuatu yang sudah dipisahkan dengan benar terlihat masih
tercampur.

## 2026-09-15 — akun A4 & A5 dibuat ulang untuk dua investor baru

Konsekuensi dari penggabungan akun Bu Mega (14 Sep): `a4@haluoleo.id` dan
`a5@haluoleo.id` sudah DIHAPUS saat itu, jadi investor baru yang membeli
unit itu tidak bisa login — bukan lupa password, akunnya memang tidak
ada. Ini sudah diantisipasi di catatan 14 Sep tapi belum dieksekusi.

**Owner memilih: dua investor terpisah** (bukan satu orang dua unit), dan
**mengisi profilnya sendiri** — akun dibuat dengan nama sementara
("Investor Unit A4"/"A5", pola yang sama dengan B2/B3/C1), investor
mengisi nama/HP/rekening asli lewat halaman "Profil & Rekening" saat
login pertama (`POST /me/investor-profile`, yang juga menulis ke
`villa_users.nama/hp` — bukan hanya `investor_profiles`).

**Langkah yang dijalankan, dan urutannya penting:**
1. Lepas pemetaan `villa_investor_units` milik Bu Mega untuk A4 dan A5
   (unique index per unit_id membuat ini WAJIB sebelum investor baru bisa
   dipetakan ke unit yang sama). Vouchernya (24 kode) dan skema pemasukan
   tetapnya TIDAK ikut terhapus — keduanya tidak bergantung pada tabel
   itu.
2. `villa_users.unit_id` Bu Mega diset NULL (sebelumnya menunjuk A5) —
   kalau tidak, kode lama yang jatuh ke `session.unit_id` sebagai
   cadangan akan membuatnya kembali "memiliki" A5 begitu pemetaan
   barunya kosong.
3. Buat 2 akun baru (role `owner`, `must_change_password=true`), petakan
   ke `villa_investor_units`, terbitkan 12 kode masing-masing lewat
   `villa_terbitkan_voucher_investor()`.

**Dibuktikan nyata:** login sungguhan untuk kedua akun berhasil (`200`
dengan token), termasuk `A5@Haluoleo.id` berhuruf besar — bug login
tidak-peka-huruf-besar (14 Sep) langsung teruji dari kasus nyata.
Pembagi dividen tetap **13** (dihitung dari unit, bukan akun — tidak
disentuh), dan `villa_investor_units` sekarang punya tepat 13 baris,
satu per unit, tidak ada yang bentrok.

**Efek pada dividen:** dua bagian yang sebelumnya tidak dibayarkan
siapa pun (milik A4 & A5, sejak Mega dialihkan ke pemasukan tetap) mulai
bulan ini akan dibagi ke dua investor baru ini — persis rencana yang
dicatat 13 Sep: *"Dua bagian itulah yang nanti diambil dua investor
baru."*

**Password sementara ada di riwayat chat owner** (via WhatsApp/pesan),
bukan di sini — keduanya wajib ganti password saat login pertama.

## 2026-09-14 — alat periksa ketersediaan Cloudbeds (dan satu salah tafsir saya)

Owner bertanya kenapa pemesanan turun untuk **20 September ke atas**.

**PENTING, jangan diulangi:** pemeriksaan menemukan 14–18 September
`roomsAvailable = 0` dan saya melaporkannya sebagai masalah mendesak.
**Itu salah — villa memang baru dibuka dari tanggal 20**, jadi tertutupnya
tanggal-tanggal sebelum itu disengaja. Owner mengoreksi: *"mmg bukanya
dari tgl 20 keatas"*. Pelajarannya: angka dari Cloudbeds tidak pernah
memberitahu apa yang DIMAKSUDKAN; tanyakan dulu apakah suatu keadaan
disengaja sebelum menyebutnya kerugian berjalan.

Untuk 20 Sep ke atas, sisi pengaturan **bersih**: semua tanggal bisa
dipesan, `closedToArrival: false`, `blocked: false`, `minLos: 1`,
`cutOff: 0`, harga normal 650/750 ribu (akhir pekan 750/850), tidak ada
room block, dan mesin harga AI masih mati. Jadi sepinya pemesanan di
rentang itu bukan soal pengaturan.

**FAKTA, BUKAN MASALAH: hanya 8 dari 13 unit yang dibuka untuk dijual,
dan itu DISENGAJA owner** (*"saya sngaja membuka 8 unit dulu"*, 14 Sep
2026). Susunannya 3 Sawah View (lengkap) + 5 dari 10 Regular. Sama
seperti tertutupnya 14–18 September, ini keputusan bisnis, bukan
kerusakan. Saya sempat melaporkan keduanya sebagai kerugian berjalan —
**dua kali salah dengan cara yang sama**, dan itu sebabnya dicatat
sebagai fakta di sini: jangan "perbaiki" apa pun yang membuat angkanya
bukan 8 tanpa bertanya lebih dulu.

**KONSEKUENSI YANG BELUM DITANGANI, dan ini menyentuh harga.** Semua
hitungan okupansi memakai `count(units)` = **13** sebagai penyebut,
padahal yang benar-benar dijual **8**. Jadi setiap angka okupansi
sistem ini **terlalu rendah sekitar 38%**:

| | Versi sistem (÷13) | Sebenarnya (÷8) |
|---|---|---|
| 26 Sep, 5 unit terisi | 38,5% | 62,5% |

Yang terpengaruh: sinyal permintaan mesin harga AI (villa terbaca lebih
sepi daripada kenyataannya → dorongan menurunkan harga), ambang promo
low season (`villa_promo_auto.ambang_okupansi_persen` = 40 — 62,5% yang
sesungguhnya terbaca 38,5%, yaitu DI BAWAH ambang, sehingga promo bisa
terpicu justru saat villa sedang laku), serta ADR/RevPAR dan
`villa_daily_inventory_snapshot`.

Belum diubah: penyebut okupansi menyentuh keputusan harga, jadi perlu
persetujuan owner lebih dulu. Kalau disetujui, penyebutnya harus
mengikuti unit yang BENAR-BENAR dijual, bukan jumlah unit yang dimiliki.

**Pelajaran yang lebih besar dari kejadiannya: villa hanya menyimpan
HARGA, tidak pernah menyimpan KETERSEDIAAN.** Tabel `villa_rates` tetap
terlihat sehat sementara tanggalnya tidak bisa dipesan siapa pun. Dua
keadaan yang sangat berbeda itu tampak identik dari sisi kita, dan
perbedaannya persis yang menentukan ada tidaknya pemesanan. Tidak ada
satu pun laporan atau cron yang akan memperingatkan kalau ini terulang.

**Alat periksanya: `GET /api/admin/cloudbeds/health`** (header
`Authorization: Bearer <integration_settings.cron.secret>`), parameter
`mulai`, `hari` (maks 45), `malam` (maks 14). Murni baca — tidak menulis
apa pun ke Cloudbeds maupun database. Mengembalikan per tanggal: bisa
dipesan atau tidak, tipe unit, sisa kamar, harga; plus `blokir_kamar`
(getRoomBlocks) dan `rate_plan_tanggal_pertama` (getRatePlans, yang
membawa minLos/closedToArrival/cutOff sehingga penyebabnya bisa disebut
dengan namanya, bukan ditebak).

**Urutan diagnosis yang terbukti berguna** (tiga tersangka, dua gugur):
1. blokir kamar → `getRoomBlocks` kosong;
2. minimum menginap → tetap tertutup untuk 1, 2, DAN 3 malam. Menguji
   satu malam saja hampir membuat saya salah lapor: tanggal ber-minLos 2
   akan terbaca persis seperti "tertutup";
3. ketersediaan → `roomsAvailable: 0`. Inilah penyebabnya.

**Belum terjawab:** untuk 20 Sep, `getAvailableRoomTypes` melaporkan 10
unit Regular tersedia sementara `getRatePlans` melaporkan 5, padahal ke-10
unit Regular kosong. Kalau angka 5 yang benar, sebagian kamar juga tidak
dijual untuk tanggal setelah 19 Sep — kehilangan yang lebih luas tapi
tidak sejelas karena tidak nol. Perlu dipastikan di kalender Cloudbeds.

## 2026-09-14 — login menolak email berhuruf besar (bug lama, mengenai semua pengguna)

`villa_login` membandingkan `email = p_email` apa adanya. Investor yang
mengetik `Mega@haluoleo.id` dijawab **"Email atau password salah"**
padahal akunnya ada dan aktif. **Papan ketik ponsel mengawali setiap
kolom dengan huruf besar secara bawaan**, jadi ini bukan kecerobohan satu
orang — siapa pun yang login dari HP bisa kena, dan pesan galatnya justru
menuduh passwordnya yang salah sehingga orang mengejar hal yang keliru
berjam-jam. Bug ini sudah ada sejak lama, bukan akibat perubahan akun
kemarin; baru terlihat sekarang karena ada yang mengirim tangkapan layar.

Diperbaiki: `lower(email) = lower(btrim(p_email))`, plus unique index
pada `lower(email)` — tanpa indeks itu, dua akun yang hanya berbeda besar
kecilnya huruf akan sama-sama cocok dan `limit 1` memilih salah satunya
sewenang-wenang, yang berarti orang bisa masuk ke akun yang bukan
miliknya. Diuji: huruf besar, huruf kecil, dan KAPITAL SEMUA sama-sama
berhasil; password salah tetap ditolak.

**Catatan terpisah:** password Bu Mega di akun gabungan disetel ulang
(`must_change_password = true`). Menyalin hash dari akun A5 ternyata
tidak membantu — passwordnya memang tidak diingat siapa pun, jadi
"login dengan password lamanya" tidak pernah bisa terjadi.

## 2026-09-13 — A4 dan A5 akan diisi dua investor baru (belum terjadi)

Owner: *"akan ada 2 orng baru yg mngisi a4 dan a5"*. Belum terjadi; ini
catatan supaya langkahnya tidak ditebak-tebak waktu harinya tiba.

**Dua bagian dividen milik A4 dan A5 memang sedang tidak dibayarkan**
(Bu Mega menerima angka tetap, bukan bagi hasil). Dua bagian itulah yang
nanti diambil dua investor baru. Jadi pembagi 13 sudah benar sejak
sekarang, dan TIDAK perlu diubah lagi saat mereka masuk.

**Kode menginap gratis: pemilik baru dapat kodenya sendiri, Bu Mega tetap
memegang kodenya** (keputusan owner 13 Sep 2026: *"buatkan kode baru jga
untuk mereka, mega ttp ada kode jga"*). Karena itu kunci unik voucher
dipindah dari `(unit_id, periode)` ke `(user_id, unit_id, periode)` —
di bawah kunci lama, pemilik baru A4 tidak akan bisa diberi kode Oktober
sama sekali selama kode Oktober Bu Mega untuk A4 masih ada, dan galatnya
hanya berupa unique violation tanpa penjelasan.

`villa_investor_vouchers.unit_id` karena itu berarti **"kode ini
diberikan atas dasar unit mana"**, bukan "hanya boleh dipakai di unit
ini" — menginapnya tetap boleh di unit mana saja yang kosong.

**Langkah saat investor baru masuk** (jangan tulis ulang loop kode acak):
1. buat/aktifkan akun `villa_users` role `owner` untuk unit itu;
2. `insert into villa_investor_units (user_id, unit_id, unit_nomor)` —
   unique per unit, jadi kepemilikan lama harus dilepas dulu;
3. `select villa_terbitkan_voucher_investor(user_id, unit_id);` — aman
   diulang, mengembalikan jumlah kode yang benar-benar dibuat.

Pembagi tidak perlu disentuh: ia menghitung `units`, bukan akun.

## 2026-09-13 — pembagi dividen kini JUMLAH UNIT, dan satu akun boleh punya dua unit

**Pembagi dividen berubah dari "jumlah akun investor aktif" menjadi
"jumlah unit". Hari ini hasilnya identik: 13.** Ini bukan perubahan
angka, tapi perubahan definisi — dan tanpa itu, penggabungan akun di
bawah akan diam-diam MENAIKKAN dividen sebelas investor lain, karena
pembagi ikut mengecil jadi 12. Owner menegaskan 13 Sep 2026: *"pembagi
ttp 13, mmg ada 1 investor yg belum masuk"* — unit yang belum ada
pemiliknya pun tetap satu bagian. `countActiveInvestors()` sekarang
menghitung `units`.

Rumus beku di `PHASE0-BASELINE.md` §2 lainnya TIDAK disentuh: 27,5%
marketing, 25% opex, 70/30, jaminan Rp 5 juta untuk **11** investor bagi
hasil. (Sebelas, bukan dua belas: 13 unit dikurangi dua unit Bu Mega yang
kini satu akun berskema tetap. Angka ini sempat saya tulis salah.)

**Bentuk akhirnya, ditegaskan owner 13 Sep 2026** (*"akun mega kluar, tp
investor ttp 13 ini yg betul"*): pembagi **13** (jumlah unit), Bu Mega
**di luar** pembagian itu dengan angka tetap Rp 7.600.000, dan 11
investor lain masing-masing menerima owner_pool ÷ 13. Dua bagian milik
unit A4 dan A5 karena itu tidak dibayarkan sebagai dividen — itu memang
maksudnya, bukan kebocoran.

**Bu Mega: satu akun untuk A4 + A5, pemasukan tetap.** Ia membeli dengan
skema harga berbeda, jadi menerima **Rp 7.600.000 pasti tiap bulan,
Okt 2026 – Sep 2031** — bukan jaminan minimal, bukan bagi hasil. Akun
`a4@haluoleo.id` dan `a5@haluoleo.id` DIHAPUS; penggantinya
`mega@haluoleo.id` (`unit_nomor` = "A4 & A5"). **Password hash-nya
disalin dari akun A5**, jadi ia login dengan kata sandi yang sudah
dikenalnya dan tidak ada kata sandi baru yang perlu dikirimkan.

Skema khususnya hidup di `villa_investor_terms` (satu baris). Akun
dengan baris di sana: jaminan minimal dimatikan (`jaminan_aktif=false`),
`bagian_anda` = angka tetapnya, dan dashboard menampilkan "Pemasukan
Tetap", bukan "Jaminan Pendapatan Minimal". Akun tanpa baris di sana
sama sekali tidak terpengaruh.

**Kepemilikan unit sekarang di `villa_investor_units`** (13 baris, unique
per unit). `villa_users.unit_id` tetap ada sebagai warisan dan masih
dipakai sebagai fallback untuk akun yang belum terpetakan, tapi yang
menentukan sekarang tabel itu. `/units` dan `/bookings` untuk investor
menyaring dengan `unitIdsForSession()`, bukan `session.unit_id` — kalau
tidak, separuh milik Bu Mega hilang dari layarnya sendiri tanpa galat.
Yang menerima dividen dua bagian juga dibaca dari sana.

**Voucher kini melekat pada UNIT, bukan akun** (`villa_investor_vouchers.unit_id`,
unique `(unit_id, periode)`). 12 poin per unit berarti pemilik dua unit
punya 24 — mustahil di bawah kunci lama `(user_id, periode)`. Bu Mega
memegang 24 kode di satu akun.

**Baris kembar `investor_profiles` sudah dibersihkan** (14 → 10, satu per
unit). Penyebabnya: halaman profil investor MEMBUAT baris baru saat
menyimpan rekening, bukan memperbarui. **Penyebab itu BELUM diperbaiki**
— duplikatnya akan muncul lagi setiap ada investor mengisi rekening.
Ketiga rekening yang sudah terisi (BNI/BRI/CIMB Niaga) utuh.

## 2026-09-13 — kode menginap gratis investor (156 kode, Okt 2026–Sep 2027)

156 kode sudah ADA di database (13 investor aktif x 12 bulan). Sisi
villa sudah lengkap; **form loonars.id belum** — sampai itu dibuat,
kode belum bisa ditukar siapa pun.

**Jangkarnya `villa_users` (role `owner`, aktif) = tepat 13 baris**, satu
per unit A1–A5/B1–B4/C1–C4. Catatan lama "13 investor vs 11 profil"
sudah tidak berlaku: `investor_profiles` TIDAK bisa dipakai sebagai
jangkar — isinya 14 baris dengan duplikat (A5 3x, C4 2x, C2 2x) dan 3
investor aktif (B2, B3, C1) tidak punya baris di sana sama sekali.
Duplikat itu belum dibereskan dan mungkin mengganggu hal lain (mis.
daftar rekening dividen).

**Keputusan owner 13 Sep 2026** (melengkapi jawaban 12 Sep):
- kode boleh dipakai di **unit mana saja yang kosong**, tidak terkunci
  ke unit investor sendiri;
- **12 poin per unit**, bukan per orang — pemilik dua unit (Ibu Mega,
  A4+A5) dapat 24;
- **staf front desk tetap melihat unit TERISI**; pengecualian okupansi
  hanya untuk harga AI, promo, dan laporan.

**Asumsi yang saya ambil sendiri dan belum dikonfirmasi: 1 kode = 1
malam.** "12 poin setahun, sebulan sekali" dibaca sebagai 12 malam.
Menginap 2 malam ditolak, bukan dipotong satu malam.

**Yang menjaga aturannya adalah database, bukan kode aplikasi:**
- `unique (user_id, periode)` — "sebulan sekali" tidak bisa dilanggar;
- `unique index bookings_voucher_sekali_pakai` pada `bookings.voucher_id`
  — satu kode hanya bisa menempel pada satu booking, selamanya, walau dua
  permintaan kembar datang bersamaan;
- `check (is_free_stay = (voucher_id is not null))` — penanda tidak bisa
  lepas dari vouchernya.
Status voucher sengaja TIDAK disimpan sebagai kolom: "terpakai" dibaca
dari booking yang menunjuknya, "hangus" dihitung dari periode terhadap
bulan berjalan.

**Pengecualian dari uang dan okupansi** — cari `is_free_stay`:
`src/lib/aiPricingEngine.ts`, `api/cron/generate-pricing-recommendations`,
`api/cron/daily-inventory-snapshot` (ini sumber okupansi/ADR/RevPAR semua
laporan, jadi pengecualiannya terjadi sekali di sini),
`api/admin/revenue-metrics`, dan villa-api `/cron/promo-low-season`.
Laporan keuangan & dividen tidak perlu disentuh sama sekali: villa-api
tidak pernah membuat baris `transactions` dari booking, dan malam gratis
bertarif 0. Rumus beku di `PHASE0-BASELINE.md` §2 tidak berubah.
`/bridge/occupancy` (kartu front desk) sengaja TIDAK dikecualikan.

**Endpoint baru:** `GET /public/voucher` (pratinjau untuk form loonars,
tidak membocorkan nama investor), `POST /public/bookings` menerima
`voucher_code` (langsung `terjadwal`, tarif 0, didorong ke Cloudbeds),
`GET /investor/vouchers`. Halaman
`src/app/investor/menginap-gratis/page.tsx`.

## 2026-09-13 — WhatsApp villa lepas dari Mkhsistem, pakai perangkat sendiri

Sejak hari ini villa **tidak lagi menumpang WhatsApp Mkhsistem**. Seluruh
WA villa (notifikasi booking, konfirmasi pembayaran, balasan `LUNAS` /
`PROMO` / `TOLAK` / `BERHENTI`) lewat perangkat WhaCenter milik villa
sendiri.

**Yang diubah hanya SATU nilai di database:**
`integration_settings.vercel_bridge.base_url`:
`https://mkh.haluoleo.id` → `https://living.haluoleo.id`.
`sendWa()` di villa-api membaca nilai ini setiap kali dipanggil (tidak
di-cache), jadi perpindahan berlaku seketika tanpa deploy — dan
mengembalikannya juga cukup satu nilai itu. Tidak ada satu baris pun kode
villa-api yang diubah untuk perpindahan ini; itu memang tujuan kontrak
`/api/wa/send` villa dibuat sama persis dengan milik Mkhsistem.

**Yang TIDAK ikut pindah:** repo loonars masih memakai Mkhsistem, dan
`integration_settings.mkh_finance_bridge` (jembatan keuangan) tidak
disentuh sama sekali. Modul villa yang sekarang menganggur di Mkhsistem
belum dibersihkan.

**Komponen di repo villa** (PR #66 dan #67, sudah di `main`):
`src/lib/whacenter.ts` (kontrak WhaCenter), `src/app/api/wa/send/route.ts`
(jalur keluar), `src/app/api/wa/webhook/route.ts` (jalur masuk +
pengenalan perintah), `src/app/api/admin/wa/route.ts` (diagnostik).
Env var di project villa di Vercel: `WHACENTER_DEVICE_ID` dan
`VILLA_BRIDGE_SECRET` (nilainya harus sama dengan
`integration_settings.vercel_bridge.secret`).

**Dibuktikan nyata, bukan diasumsikan** (13 Sep 2026):
- perangkat `CONNECTED` dibaca dari produksi lewat `GET /api/admin/wa`;
- pesan masuk benar-benar diantar WhaCenter ke
  `/api/wa/webhook` (terlihat di log runtime Vercel);
- `LUNAS 000000` dijawab villa dengan "Kode 000000 tidak ditemukan…",
  membuktikan parsing perintah, panggilan `/bridge/confirm-payment`, dan
  balasan keluar lewat perangkat villa — tanpa mengubah data apa pun;
- `POST /api/wa/send` menjawab `200 {"success":true}` **dan** pesannya
  benar-benar sampai ke HP owner (dikonfirmasi owner).

**Dua hal yang harus diingat:**
1. **WhaCenter mengantar pesan masuk DUA KALI untuk satu pesan** (terlihat
   jelas di log: dua `POST /api/wa/webhook` pada detik yang sama). Perintah
   karena itu wajib idempoten. `LUNAS` (`already_confirmed`) dan `PROMO`
   (`already_sent`) sudah aman; perintah baru apa pun harus dibuat aman
   dengan cara yang sama.
2. **Nomor villa sempat kena tanda spam WhatsApp dan terputus 5 jam —
   padahal belum sekali pun mengirim promo massal.** Ini peringatan untuk
   modul promo: rencana lama (satu `PROMO <kode>` → 40 pesan sekaligus ke
   nomor yang belum pernah chat duluan) berisiko memblokir nomor villa
   permanen, dan kalau itu terjadi SELURUH alur WA villa mati. Promo tetap
   `mode: 'pantau'`; sebelum dinyalakan perlu batas harian jauh lebih kecil
   dan jeda antar pesan. Belum dikerjakan.

**Diagnostik kalau WA villa bermasalah:** `GET /api/admin/wa` (header
`Authorization: Bearer <integration_settings.cron.secret>`) memberi status
perangkat dan alamat webhook yang seharusnya. Catatan: `getWebhook` milik
WhaCenter tidak pernah mengembalikan JSON yang bisa dibaca, jadi
`webhook_tersimpan` selalu `null` — itu **bukan** tanda webhook belum
terdaftar. Satu-satunya pembuktian yang sahih adalah mengirim pesan nyata
dan melihat hit di log runtime Vercel.

## 2026-09-12 — dua garapan paralel disatukan: permintaan kini dibaca dari EMPAT sinyal

Dua sesi menggarap `src/lib/aiPricingEngine.ts` bersamaan. Branch
`claude/serene-cori-ne0rhb` (komit `e979a59`, berbasis `main` lama)
menambah pace + indeks minat pasar berangka; branch ini menambah musim
sepi + lead time + minat pasar kualitatif. Keduanya saling melengkapi,
bukan bertentangan, jadi disatukan — bukan salah satu dibuang.

**Cara penyatuannya (yang penting diingat):**
- **Minat pasar dulunya dua versi dari sinyal yang SAMA.** Indeks berangka
  per bulan (`integration_settings.villa_market_search_index`, 0-100,
  relatif baseline tahun itu) jadi **utama**, dan bacaan kualitatif
  `demand_trend` hanya dipakai **kalau indeksnya tidak ada**. Tidak pernah
  keduanya sekaligus — itu akan menghitung sinyal yang sama dua kali.
- **Lead time** dikenakan pada sinyal okupansi **sebelum** masuk
  penggabungan, bukan sebagai langkah terpisah.
- **Musim sepi** tidak bersinggungan dengan keduanya, tetap di langkah 4.
- Pace, indeks pasar, dan helper-nya dipindah ke dalam fungsi murni
  `decideRateForDate` supaya ikut teruji.

**Empat sinyal permintaan, digabung berbobot** (`SIGNAL_WEIGHTS`):

| Sinyal | Bobot | Batas gerak | Butuh apa |
|---|---|---|---|
| Okupansi (ditimbang lead time) | 0,60 | setting owner | selalu ada |
| Pace vs tanggal pembanding | 0,28 | ±8% | ≥6 tanggal lewat, ≥15 booking |
| Minat pasar (indeks bulanan) | 0,12 | ±5% | indeks hasil riset |
| — cadangan: tren kualitatif | 0,12 | ±3% | `demand_trend` |

Aturan yang membuat lapisan ini aman: **sinyal tanpa data tidak dianggap
netral lalu ikut menarik rata-rata ke nol — ia tidak ikut sama sekali, dan
bobot sisanya dinormalkan.** Kalau hanya okupansi yang punya data (keadaan
hari ini), hasilnya identik dengan mesin sebelum lapisan ini ada. Pace dan
minat pasar juga ditahan saat cold start, sama seperti event uplift.

**Pace dihitung dari `bookings.created_at`, bukan dari
`villa_daily_inventory_snapshot`.** Snapshot hanya merekam keadaan hari
itu, jadi ia tidak bisa menjawab "20 Oktober sudah seramai apa waktu kita
masih 30 hari sebelumnya". `created_at` menjawabnya secara surut, tanpa
menunggu berbulan-bulan mengumpulkan snapshot baru. Dipisah
weekend/bukan-weekend, karena membandingkan Sabtu dengan Selasa akan
membuat setiap Sabtu terlihat "lebih cepat dari biasanya" selamanya.

**Verifikasi**: 51 tes hijau (38 di antaranya khusus penalaran harga), dan
simulasi kering dengan data produksi asli (364 tanggal × 2 tipe kamar,
dibanding harga yang hidup di Cloudbeds) → **nol perubahan harga**, sama
seperti sebelum penyatuan. Memang begitu yang diharapkan: hari ini baru 8
booking, jadi cold start menahan pace dan minat pasar, dan pace belum
punya tanggal pembanding sama sekali.

**Sisi Mkhsistem** kini mengembalikan `search_index_by_month` (0-100 per
bulan, 12 bulan ke depan) di samping `direction` — keduanya dari riset yang
sama, dan promptnya diminta konsisten: bulan yang ditandai `direction:
"turun"` tidak boleh muncul tinggi di indeksnya.

**Branch `claude/serene-cori-ne0rhb` sudah tidak perlu di-merge** — seluruh
isinya sudah masuk lewat penyatuan ini. Kalau di-merge apa adanya justru
akan menimpa balik musim sepi dan lead time.

## 2026-09-12 — verifikasi: API Cloudbeds bisa mengubah harga, DAN cron malamnya memang jalan otomatis

Owner bertanya: pastikan dulu API ke Cloudbeds benar-benar bisa **menulis**
harga, bukan cuma membaca.

**TERBUKTI BISA MENULIS.** Buktinya bukan catatan lama, tapi isi Cloudbeds
sekarang (dicek lewat `villa_rates`, yang menurut aturan single-writer
hanya diisi dari hasil baca-balik Cloudbeds — mesin harga tidak pernah
menulisnya langsung):

- 368 baris per tipe kamar, **2026-09-04 s/d 2027-09-11** — satu tahun
  penuh, sesuai `WINDOW_DAYS = 365`.
- Angkanya persis aritmetika mesin harga, sampai rupiahnya:
  Standard 650.000 dasar / 750.000 Jum-Sab, dan pada periode
  **24 Des–2 Jan** (persis baris `ai_recurring_peak` "Libur Natal dan
  Tahun Baru") menjadi 780.000 / 900.000 = tepat ×1,2.
  Sawah View 750.000 / 850.000 → 900.000 / 1.020.000, juga tepat ×1,2.
  23 Des dan 3 Jan kembali ke harga dasar — batas periodenya pas.
- Tidak ada manusia yang menetapkan 1.020.000 dengan tangan pada rentang
  tanggal yang persis itu. Angka-angka ini berasal dari mesin harga villa,
  ditulis ke Cloudbeds lewat `putRate`, lalu dibaca balik.

Jadi kunci API-nya punya izin tulis rate dan jalurnya bekerja
ujung-ke-ujung. `getRate` (baca) juga terverifikasi: log
`sync-cloudbeds-rates` 2026-09-12 18:21 UTC melaporkan
`dates_synced: 364` untuk kedua tipe kamar.

**CRON MALAMNYA JALAN — dan ini sempat saya simpulkan keliru.** Log
runtime Vercel tidak memperlihatkan `/api/cron/ai-dynamic-pricing` sama
sekali, yang sempat saya baca sebagai "cronnya tidak jalan". Itu salah:
**retensi log Vercel hobby hanya ~1 jam**, bukan 24 jam seperti yang
disiratkan parameter kuerinya. Ketahuan dari `sync-cloudbeds-reservations`
yang jadwalnya `*/10` tapi hanya muncul **6 kali** — persis 60 menit. Cron
harga jam 17:10 UTC memang di luar jendela itu.

Bukti bahwa ia benar-benar jalan ada di jejak `villa_rates.updated_at`
(kolom ini hanya berubah kalau nilai harganya berubah):

| Waktu sinkron (UTC) | Baris berubah |
|---|---|
| 2026-09-12 **17:21** | 2 |
| 2026-09-12 04:21 | 534 |
| 2026-09-11 **17:17** | 2 |
| 2026-09-11 14:29 | 106 |

Dua malam berturut-turut pada **17:17** dan **17:21** — persis jendela cron
`10 17 * * *` (00:10 WIB). Dan tepat **2 baris** tiap malam: satu tanggal
jauh-depan baru per tipe kamar, tanda tangan jendela 365 hari yang bergulir
maju sehari tiap malam. Itu hanya mungkin kalau push harganya sungguh
berjalan. Nilainya pun konsisten dengan aturan mesin harga: 2027-09-11
(Sabtu) Standard 750.000 = tarif akhir pekan, 2027-09-09 (Kamis) 650.000 =
tarif dasar.

Jadi rantainya utuh dan otonom tiap malam: putuskan harga → `putRate` ke
Cloudbeds → baca balik → cerminkan ke `villa_rates`. **Tidak ada yang perlu
dipindahkan ke pg_cron**; menambahkannya justru akan membuat push ganda.

Catatan untuk sesi berikutnya: jangan simpulkan sebuah cron mati dari
ketiadaannya di log runtime Vercel pada plan hobby. Hitung dulu berapa
entri yang muncul untuk job yang frekuensinya diketahui — itu memberi tahu
lebar jendela retensi yang sebenarnya. Sandbox sesi ini juga diblokir
keluar ke `api.cloudbeds.com` (proxy 403), jadi verifikasi harus lewat
jejak di database, bukan panggilan langsung.

## 2026-09-12 — penalaran harga AI diperluas (SUDAH DI `main`, sudah live)

Owner sedang mempelajari Duetto dan meminta AI penentu harga menimbang
lebih banyak indikator, bukan hanya okupansi: minat pencarian villa di
Jogja, riset kompetitor, berita event/tanggal merah/libur sekolah, dan
**bulan-bulan sepi seperti bulan puasa**. Owner juga menegaskan AI boleh
menetapkan harga sendiri karena batas bawahnya sudah dia pasang
(`villa_room_types.min_rate`).

Yang berubah (detail lengkap di CHANGELOG.md):
- **Musim sepi bisa menurunkan harga.** Baris `villa_high_season_periods`
  dengan persen negatif dan `created_by='ai_low_season'`. Diskon langsung
  berlaku (tidak menunggu pickup), tapi ditarik kalau tanggalnya ternyata
  laku ≥50%. `min_rate` tetap lantai keras.
- **`demand_trend` akhirnya dipakai.** Sejak 2026-09-11 sinyal ini diriset
  mingguan lalu dibuang; sekarang disimpan ke
  `integration_settings.revenue_engine.market_demand` dan menggeser harga
  maksimal ±3% saja, kedaluwarsa 30 hari.
- **Lead time diperhitungkan.** Diskon okupansi rendah menanjak seiring
  dekatnya tanggal (≤14 hari penuh, ≤45 hari separuh, di atas itu tidak
  ada). Kenaikan okupansi tinggi tidak diperlakukan begitu.
- **`decideRateForDate` jadi fungsi murni + 29 tes** (`npm test`,
  42 tes hijau seluruh repo). Ini gerbang otomatis pertama yang dimiliki
  logika harga.

**Di-merge 2026-09-12 atas persetujuan owner** (villa PR #63 → `main`,
Mkhsistem PR #63 → `claude/mk-connect-app-o9zw2p`; kedua deployment
produksi `READY`). Tidak ada migrasi dan tidak ada perubahan skema.

**Simulasi kering sebelum merge, dengan data produksi asli**: 364 tanggal
× 2 tipe kamar, hasil mesin harga baru dibandingkan dengan harga yang
sedang hidup di Cloudbeds → **nol perubahan harga**. Itu memang yang
diharapkan: sinyal barunya menyala bertahap saat datanya tersedia —
periode sepi setelah riset Mkhsistem berikutnya (staleness 7 hari, riset
terakhir 2026-09-12 04:23), minat pasar setelah refresh yang sama, dan
lead time baru setelah riwayat pemesanan melewati ambang cold start
(`COLD_START_MIN_BOOKINGS = 20`; sekarang baru 8 booking). Harga live
pembandingnya diverifikasi dulu ke database: 728 baris, 0 tidak cocok.

**PERHATIAN — ada branch paralel yang menggarap berkas yang sama.**
`claude/serene-cori-ne0rhb` (satu komit, `e979a59` "Mesin harga membaca
tiga sinyal permintaan, bukan satu") mengubah `src/lib/aiPricingEngine.ts`
dan `src/lib/aiBridge.ts` juga — menambah gabungan berbobot okupansi 0,60
/ pace 0,28 / minat pasar 0,12. Branch itu berbasis `main` yang LAMA
(`a75b8d1`), jadi **akan bentrok** dengan yang barusan di-merge, dan
lapisan "minat pasar"-nya tumpang tindih dengan SINYAL 2 di sini. Jangan
merge branch itu tanpa menyatukan keduanya lebih dulu — kalau tidak, salah
satu penalaran akan hilang diam-diam.

**PENTING — `ai_autopush_enabled` ternyata sudah `true`** (diubah
2026-09-11 14:48 UTC; diverifikasi lewat Supabase MCP 2026-09-12).
Catatan lama di bagian "Pricing architecture" di bawah yang menyebutnya
`false` sudah tidak berlaku. Artinya: begitu branch ini di-merge dan run
harga berikutnya jalan, harga tamu di semua OTA **benar-benar ikut
berubah**. Ini bukan lagi dry run.

**Sisi riset (repo Mkhsistem, branch sama)**: `researchVillaMarketDemand`
kini melaporkan periode `direction: "turun"` selain "naik", plus kalender
tanggal merah nasional termasuk "harpitnas". Perlu **deploy Mkhsistem**
sebelum periode sepi benar-benar muncul di villa — sampai itu terjadi,
villa hanya menerima periode ramai seperti sebelumnya (pembacaan default
yang aman, bukan kegagalan).

**Catatan terkait**: "AI competitor research fails with AI bridge failed:
200" yang tercatat di bagian "Pricing architecture" di bawah **sudah
tidak berlaku**. Penyebabnya rute bridge belum terdaftar di
`PUBLIC_PATHS` middleware Mkhsistem sehingga POST-nya mendarat di halaman
/login (200 HTML); sudah diperbaiki dan ada di branch produksi Mkhsistem.
Terverifikasi hari ini: baris `ai_recurring_peak` dibuat cron 2026-09-12
04:23 UTC, dan `villa_competitor_rates` terisi 2026-09-11.

## 2026-09-12 — modul database tamu + promo LIVE, tapi pengiriman promo masih MODE PANTAU
villa-api **v61**. Tiga repo ikut: villa (skema, API, halaman admin), loonars
(kolom kode promo), Mkhsistem (routing balasan `PROMO`/`TOLAK`/`BERHENTI`).

**Harga promo tidak pernah menembus lantai.** Promo tidak menyimpan angka
diskon; ia mengaktifkan `villa_room_types.min_rate` (Standard 600rb, Sawah View
700rb). `hitungHargaPromo()` menjepit ke min_rate **termasuk** untuk
`mode_harga='harga_tetap'`, dan menolak promo yang lebih mahal dari harga
normal. `villa_rates` tidak disentuh, jadi harga OTA tidak berubah.

**Keadaan sekarang (per 2026-09-12):**
- `integration_settings.villa_promo_auto` = `{aktif:true, mode:'pantau',
  ambang_okupansi_persen:40, horizon_hari:14, jeda_hari:30, promo_kode:'TAMUSETIA'}`
- pg_cron **jobid 108 `villa-promo-low-season`, `0 2 * * *`** (09:00 WIB)
- Mode `pantau` menghitung dan melaporkan saja — **nol usulan, nol WA**.
  Terverifikasi: okupansi 1,1%, 6 calon penerima, tidak ada yang dikirim.
- Promo `TAMUSETIA` aktif (batas bawah, kuota 20, pesan s/d 2026-10-12,
  menginap s/d 2026-11-11), **0 kali dipakai**.
- Untuk mulai mengusulkan: ubah `mode` ke `'usul'`. Owner menahannya karena
  datanya belum cukup — dari 103 baris tamu, hanya **7 yang pernah menginap**,
  6 yang layak dikirimi, 1 tamu berulang, 2 punya email.

**Sudah pernah dikirim WA sungguhan?** Ya, tapi hanya ke nomor owner
(`085872222777`), dua kali, sebagai uji. Belum ada satu pun tamu asli yang
dikirimi.

**Jalur balasan WA belum pernah diuji manusia.** `LUNAS` maupun `PROMO`
memakai jalur yang sama (Mkhsistem webhook-handler). Batch `1DE5AA` disiapkan
berisi hanya nomor owner supaya dia bisa membalas `PROMO 1DE5AA` dan
membuktikannya. Kalau tidak ada balasan, berarti jalur balasan memang belum
pernah bekerja — dan itu juga berarti `LUNAS` belum pernah bekerja.

**Dua bug saya sendiri yang ketahuan dan sudah diperbaiki di sini:**
1. `sendWa` menerima kunci yang tidak ada kolomnya (`promo_batch_id`) →
   SELURUH insert `wa_messages_log` gagal diam-diam. Sekarang meta disaring
   ke kolom yang ada dan kegagalan insert dicatat ke console.
2. `sendWa` tidak melaporkan berhasil/gagal → `villa_promo_sends` mengklaim
   'terkirim' untuk pesan yang belum tentu sampai. Sekarang mengembalikan
   boolean; status dicatat apa adanya, dan penanda "baru dikirimi promo"
   hanya dipasang kalau memang terkirim.
3. Usulan yang didiamkan memblokir cron promo selamanya (kedaluwarsa 48 jam
   hanya dihitung saat ada yang mencoba menyetujui). Sekarang dikedaluwarsakan
   di dalam cron, dan penjaganya hanya berlaku untuk mode `usul`.

## 2026-09-12 — form web kini menanyakan email + jumlah tamu; Cloudbeds berhenti menerima data karangan (villa-api v58)
Pemesanan lewat loonars.id **sudah** masuk Cloudbeds sebelum ini, tapi dengan
data yang dikarang `pushBookingToCloudbeds` sendiri, karena formnya tidak
pernah menanyakannya: `guestEmail` = `booking-<8 hex>@guest.loonars.id`,
`adults` = 1, `children` = 0 — dipatok. Jadi setiap pemesanan web tampil di
Cloudbeds, dan lewat Cloudbeds di semua OTA, sebagai satu dewasa tanpa anak.

Sekarang: form menanyakan **Email (wajib)**, **Dewasa (1–8, default 2)** dan
**Anak (0–6)**; email disimpan ke `guests.email`, jumlah tamu ke kolom baru
`bookings.adults`/`children` (lihat DATABASE.md — migrasi disetujui owner).
`putReservation` (pindah kamar) ikut membawa jumlah tamu, supaya memindahkan
kamar tidak sekalian menurunkannya jadi 1/0.

**Risiko yang sengaja diterima:** dulu 1/0 selalu diterima Cloudbeds; sekarang
tamu bisa memilih 8 dewasa dan itu bisa melebihi kapasitas tipe kamar, yang
membuat Cloudbeds menolak seluruh push dengan `Invalid Parameters` — kamar
tidak terblokir dan tetap dijual di OTA. Penangkalnya varian pamungkas
`room_type_only_occupancy_fallback_1_0` yang mundur ke 1/0 agar kamarnya tetap
terblokir; varian yang dipakai tercatat di `cloudbeds_events_log`.
`villa_room_types.capacity` masih `null` untuk kedua tipe, jadi batas tamu
sebenarnya tidak bisa divalidasi di sisi kita.

Terverifikasi di produksi lewat pg_net (uji negatif, tidak membuat booking):
tanpa email → 400 `Email tidak valid`; email ngawur → 400 sama; `adults: 0` →
400 `Jumlah dewasa tidak valid`. **Belum pernah diuji ke Cloudbeds sungguhan** —
push pertama dari pemesanan asli perlu dilihat di `cloudbeds_events_log`.

## 2026-09-12 — booking website yang tidak dibayar 1 jam kini DIBATALKAN, bukan cuma disembunyikan
Sebelumnya `PENDING_PAYMENT_HOLD_MINUTES = 60` di
`src/app/front-desk/booking/page.tsx` hanyalah aturan **tampilan**: booking
`menunggu_pembayaran` yang lewat sejam berhenti digambar di kalender, tapi
barisnya tetap `menunggu_pembayaran` selamanya dan halaman tamu di loonars.id
terus menampilkan QRIS seolah unitnya masih ditahan. Owner menemukannya di
HP-nya: layar "Selesaikan Pembayaran" untuk booking yang barisnya sudah tidak
ada sama sekali (diverifikasi lewat Supabase MCP — nol baris
`menunggu_pembayaran`, dan villa-api v56 tidak punya logika kedaluwarsa apa
pun).

Sekarang, sejak villa-api **v57**:
- `POST /cron/expire-pending-bookings` (dijaga `x-cron-secret`) mengubah
  booking website `menunggu_pembayaran` yang lebih tua dari 60 menit menjadi
  `batal`, menulis penanda `[Kedaluwarsa otomatis] <ISO>` ke `catatan`, dan
  memberi notifikasi staf. Dibatalkan, **tidak dihapus**.
- Dijadwalkan pg_cron **jobid 107 `villa-expire-pending-bookings`, `*/5 * * * *`**,
  lewat `public.villa_cron_post('/cron/expire-pending-bookings')`. Terverifikasi
  jalan: uji ujung-ke-ujung dengan satu baris uji (dibuat, dibatalkan mesin,
  lalu dihapus) mengembalikan `{"expired":1}`, dan jalan terjadwal pertama
  15:30 UTC 2026-09-12 `succeeded`.
- `/bridge/confirm-payment` masih bisa **menghidupkan kembali** booking yang
  dibatalkan mesin (hanya yang berpenanda itu), supaya balasan `LUNAS` owner
  yang datang setelah batas waktu tidak menolak tamu yang uangnya sudah masuk.
  Yang dibatalkan manusia tetap batal.
- `/public/bookings/status` kini mengirim `cancelled`, `expired`,
  `hold_expires_at`, `hold_minutes`.
- Sisi tamu (repo `loonars`, PR #5): 404 dan `cancelled` mengakhiri layar
  pembayaran, `localStorage` dibersihkan, muncul layar "Pemesanan Kedaluwarsa"
  + tombol Pesan Ulang, dan sisa waktu tahanan ditampilkan selama masih
  berlaku.

Catatan: aturan 60 menit sekarang ada di **dua** tempat — konstanta tampilan di
kalender front-desk dan `PENDING_PAYMENT_HOLD_MINUTES` di villa-api. Kalau
angkanya diubah, ubah keduanya.

## 2026-09-10 — Cloudbeds sync is now two-way (villa → Cloudbeds added; NOT YET ACTIVE — needs one-time secret)
`villa-api`'s `POST /bookings` now also pushes walk-in/direct bookings out
to Cloudbeds (`POST /postReservation`) so a room booked at Front Desk shows
blocked in Cloudbeds/OTAs too — until now the sync only worked one way
(Cloudbeds → villa, via the existing webhook). Root cause of the owner's
report that "staff-entered Cloudbeds data doesn't match villa" was actually
that the **inbound** webhook itself was never confirmed registered on
Cloudbeds' side (`cloudbeds_events_log` has 0 rows as of this session) —
that is still open and separate from this outbound addition; see
INTEGRATIONS.md's Cloudbeds section for both directions' detail.
**Not live yet**: needs a `CLOUDBEDS_API_KEY` Supabase Edge Function secret
on `villa-api` (separate from the same-named Vercel env var the frontend
already has) before the outbound push does anything, and separately still
needs the Cloudbeds-side webhook registration for the inbound direction to
start working, plus the `SUPABASE_ACCESS_TOKEN` CI secret noted below
before this code change even reaches production. Contract verified against
Cloudbeds' public OpenAPI spec (`github.com/cloudbeds/openapi-specs`,
`pms-v1.2`) — not guessed. Known gap: villa-side booking cancellation does
not yet push a cancellation to Cloudbeds.

## 2026-09-10 — villa-api is now deployed from this repo via CI (NOT YET ACTIVE — needs one-time secret)
Added `.github/workflows/deploy-villa-api.yml`: pushing a change under
`supabase/functions/villa-api/` to `main` now deploys it to the live
`villa-api` Edge Function via Supabase CLI automatically. Goal (owner
request): villa-api should no longer be something edited only in the
Supabase dashboard and separately hunted down when someone needs the
source — this repo becomes the single source of truth for it, same as the
frontend. Also re-synced the previously-stale `index.ts` snapshot (was v26
from 2026-09-04, live had moved to v34) — see
`supabase/functions/villa-api/README.md` for detail on both.
**Not live yet**: the workflow needs a `SUPABASE_ACCESS_TOKEN` repo secret
(GitHub Settings → Secrets and variables → Actions) that only the owner can
add — until then the workflow will fail visibly in the Actions tab rather
than deploying. Scope explicitly does NOT cover Mkhsistem's WhatsApp/AI
bridge calls (`sendWa()`, Gemini vision) — those remain intentionally
external per owner instruction; only villa-api itself was brought in-repo.

## 2026-09-10 — Automatic monthly income sync to MKH Property (LIVE, `villa-api` v34)
Villa-api gained `POST /cron/sync-mkh-income` (deployed as version 34) plus a
new Vercel Cron (`/api/cron/sync-mkh-income`, 1st of month 09:15 WITA) that
pushes last month's rental + cafe/spa/lainnya income to MKH Property's new
`pendapatan_villa` table (a separate internal finance app/Supabase project).
See CHANGELOG.md for full detail. **Not yet observed firing for real** — the
cron hasn't run on its schedule yet as of this note, and this session's
sandbox couldn't make direct HTTPS calls to villa-api to test it manually
(network policy blocked `*.supabase.co`). Confirm after the 1st of the next
month that a row with `sumber='villa_api'` lands in MKH Property's
`pendapatan_villa`, or trigger `/api/cron/sync-mkh-income` manually with a
valid `CRON_SECRET` sooner if you want to check before then.

## Last known completed work (on `main`)
- UI redesign to a "light, colorful mobile-style theme" (merged 2026-08-18, commits `932f6de`/`54fc066`).
- Double-booking prevention by date on Front Desk (`346ab86`).
- Cloudbeds webhook moved to a Vercel Route Handler, DB-backed integration settings removed (`2ddcff5`).
- Migration from a static HTML dashboard to Next.js App Router (`bc74d1b`, `6e47839`, `8b2524a`), completed 2026-08-09.
- Full role-based system (investor/admin/receptionist dashboards) with Cloudbeds + WhatsApp integration scaffolding (`f2ffcfb`).
- Hardcoded admin token fixed, `.gitignore` added (`17ebbd8`).

## Current active work (2026-09-08, on `claude/villa-supabase-empty-db-xsadl5`)
- Fixed the reported "semuanya gagal memuat: unauthorized" on every admin page. Root cause was an expired session, not missing data: `villa-api` tokens live 7 days, the admin's `last_login` was 8d7h old, and the frontend never validated the token or handled a 401 — so the UI rendered while every request failed. Sessions now end cleanly and redirect to `/login?expired=1`. See CHANGELOG.md 2026-09-08.
- Confirmed the database is **not** empty (13 units, 19 villa_users, 5 investor_profiles, 13 cloudbeds mappings). Supabase Table Editor's row counts are stale `reltuples` estimates and had drifted to 0 for `units`, which is what made it look empty.
- **CLOSED 2026-09-08**: migration `20260908000001_enable_rls_on_exposed_villa_tables.sql` applied (owner-approved). 14 villa-owned tables (10 `villa_*` revenue tables, 3 amenities tables, `cctv_disciplinary_reports`) were readable AND writable by anyone holding the project's public anon key; RLS is now on for all of them. See DATABASE.md.

## Current active work (2026-09-01, merged to `main` and deployed)
- Investors can now fill/update a dividend bank account (`bank_nama`/`no_rekening`/`nama_pemilik_rekening`) anytime from a new `/investor/profil` page, not just once at first login. Admin's `admin/investors` table now shows each investor's rekening. A new Vercel Cron (tanggal 25, 09:00 WITA) computes the month's per-investor dividend split and sends the transfer list to every active admin account via WhatsApp. `villa-api` v25, migration `add_investor_bank_account_fields` — see ARCHITECTURE.md/DATABASE.md/CHANGELOG.md for full detail.
- Resolves the "not yet deployed to Mkhsistem production" caveat on the AI CCTV checkpoint module (below): Mkhsistem's `app/api/villa/ai/cctv-vision` bridge endpoint is now deployed to Mkhsistem's production branch (`claude/mk-connect-app-o9zw2p`) and live — the AI checkpoint module's Gemini calls should now succeed rather than fail closed. Not yet verified end-to-end against a real EZVIZ snapshot.

## Current active work (on `claude/villa-repo-construction-mapping-pi2uat`, 2026-08-27)
- Added an outbound Cloudbeds API client (`src/lib/cloudbedsApi.ts`) and a read-only `/api/admin/cloudbeds/rooms` route so the admin Cloudbeds mapping page can offer a live room picker once `CLOUDBEDS_API_KEY` is set, instead of only manual Room ID entry. Falls back to manual entry gracefully (503/error) when the key is unset — verified via `tsc --noEmit` and `next build`, not yet tested against a real Cloudbeds account (no key was provided). Room-mapping *storage* is unchanged, still owned by the external `villa-api` Edge Function.
- Added `.env.example` (previously a documented gap) listing `CLOUDBEDS_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDBEDS_API_KEY`, `CLOUDBEDS_PROPERTY_ID` — no values.
- See INTEGRATIONS.md / ENVIRONMENT.md for details.

## Current active work (open, unmerged branches)
- `claude/security-3-repos-tj69ek`: Next.js 15.1→16.3.1 CVE upgrade, Cloudbeds webhook payload validation, server-side proxy hardening for role gating.
- `claude/frigate-ai-cctv-module-eqwuri`: AI CCTV presence-detection module using EZVIZ + Gemini (via a bridge to a sibling system "Mkhsistem"), not yet on `main`.
- Several other `claude/*` branches exist (`file-hub-repo-integration`, `repo-overview`, `security-audit-repos`, `tampilan-design-request`, `villa-system-no-receptionist`) whose content was not deep-audited under this task's scope (audit focused on `main`); their existence alone signals ongoing/parallel exploratory work.

## Unfinished / not yet on `main`
- Client-side-only role gating has a known hardening branch not yet merged — production `main` currently relies solely on client-side redirect logic for route protection (server-side enforcement, if any, lives in the unaudited `villa-api`).
- Cloudbeds webhook payload validation hardening exists only on a branch, not `main`.
- Next.js dependency on `main` is version 15.1, not the CVE-patched 16.3.1 present on an unmerged branch.
- AI CCTV module is entirely absent from `main`.

## Known bugs
None explicitly documented as open/unfixed in this repo (no issue tracker content, no TODO/FIXME comments found in source). Historical "security: fix hardcoded admin token" (`17ebbd8`) indicates that class of issue was previously found and fixed on `main`.

## Technical debt
- **No automated tests** anywhere in the repo.
- **No CI/CD pipeline** (no `.github/workflows`) — quality gates before deploy are manual/best-effort only.
- **No `.env.example`** — onboarding a new developer requires reverse-engineering required env vars from source (see ENVIRONMENT.md).
- **Core backend (`villa-api`) has a manually-synced source snapshot at `supabase/functions/villa-api/index.ts`, not a live/automated one** — it is not deployed from this repo (no CI wires it to Supabase) and is not kept in sync automatically, so it drifts whenever someone deploys a `villa-api` change without also re-running the capture step in `supabase/functions/villa-api/README.md`. It had in fact drifted (last captured v26 on 2026-09-04, live had moved to v34) until re-synced 2026-09-10 in this session. Treat this file as **possibly stale** unless it was just re-synced — verify against `mcp__Supabase__get_edge_function` before trusting it for anything version-sensitive, per the villa-api verification rule in `CLAUDE.md`.
- **No database migrations tracked in git** — schema changes are presumably made ad hoc against the live Supabase project.

## Blocked work
None identified from the repo itself. UNKNOWN — NEEDS CONFIRMATION whether any of the open `claude/*` branches are blocked pending review/decisions.

## Important warnings
- **Update 2026-08-27**: `villa-api`'s source was read directly (Supabase MCP `get_edge_function`) and DOES implement real server-side session verification (HMAC-signed tokens) and role authorization (admin/staff/owner gates, 403 on mismatch) — see ARCHITECTURE.md "Backend"/"Auth / Authz". The line below (server-side auth "cannot be verified") predates that read and is now outdated for `villa-api` itself; kept for history.
- ~~Do not assume server-side authorization exists beyond what `villa-api` implements — it cannot be verified from this repo.~~
- The Cloudbeds webhook silently no-ops with 503 responses if `CLOUDBEDS_WEBHOOK_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` are missing in the Vercel environment — a misconfiguration would not crash the build, only fail silently at runtime.
- The Supabase project URL is hardcoded, not environment-driven — there is no built-in mechanism to point this app at a different Supabase project without editing source.

## Production status
Believed ACTIVE (Vercel-hosted Next.js app), based on `vercel.json` and a "fix Vercel project framework setting" commit — but no production URL is recorded in-repo to directly verify. UNKNOWN — NEEDS CONFIRMATION for a direct, current production health check.

## Mobile status
NOT IMPLEMENTED — no Capacitor/native mobile wrapper exists (see MOBILE_BUILD.md). Web-only, responsive via Tailwind breakpoints.

## Database status
Live Supabase Postgres project in use; schema/migrations are not tracked in this repository (see DATABASE.md) — status of the database itself (health, RLS coverage, backups) is UNKNOWN — NEEDS CONFIRMATION from outside this repo.

## Pricing architecture (added 2026-09-11, all points verified against live data/code)

How a guest price is decided today:

1. **`villa_room_types.base_rate`** (Standard 650,000 / Sawah View 750,000) is
   the fixed anchor. Nothing automated writes it. `min_rate`/`max_rate`
   clamp every computed price.
2. **`/api/cron/ai-dynamic-pricing`** (00:10 WIB) computes a price per date
   from that anchor — occupancy, weekend surcharge, high season, AI
   competitor research (via Mkhsistem's bridge; outside high season the
   market average acts as a CAP, never a floor). It pushes to Cloudbeds
   **only** when `villa_pricing_settings.ai_autopush_enabled` is true.
   **Update 2026-09-12: this is now `true`** (set 2026-09-11 14:48 UTC,
   verified via Supabase MCP) — the note below saying it is `false` was
   accurate when written and is not any more. Pushes are live. Every
   push is read back from Cloudbeds and verified date by date.
3. **`/api/cron/sync-cloudbeds-rates`** (00:25 WIB) mirrors Cloudbeds' live
   rates for **90 days** into `villa_rates` and sets `units.tarif_harian`
   to today's rate. This is the **only** writer of local price state —
   the AI engine never writes it directly, so villa and the OTAs cannot
   silently disagree.
4. **`villa-api` v39 `POST /bookings`** (both the public website endpoint
   and the staff/front-desk one) prices **every night** of a `harian`
   booking from `villa_rates`, falling back to `units.tarif_harian` only
   for a night with no row. So website, front-desk and walk-in guests are
   all charged the same published per-date price as OTA guests. `bulanan`
   stays still use `tarif_bulanan`.

Defects fixed the same day, recorded so they are not reintroduced:
- The engine used to compute from `units.tarif_harian` and write its result
  back there, compounding each run; two runs moved Standard 650,000 →
  716,500 and Sawah View 750,000 → 797,500 **upward during low occupancy**
  (weekend surcharge baked into the base: `x → 0.9x + 100,000` converges to
  `max_rate`). Fixed by the fixed `base_rate` anchor.
- `tarif_harian` was updated even when the Cloudbeds push failed, diverging
  villa's direct price from the OTA price.
- `villa_rates`' unique key was `NULLS DISTINCT` on a nullable
  `rate_plan_id`, so it did not prevent duplicate rows and `ON CONFLICT`
  upserts (including villa-api's own) would insert instead of update.
  Fixed in `20260911000002`.
- The rate mirror covered only 14 days, so bookings further out silently
  fell back to a flat rate that did not match the OTA price. Now 90 days.

**Timezone**: the villa is at Jalan Palagan, Sleman, **Yogyakarta = WIB
(UTC+7)**. The guest registration card wrongly said WITA until 2026-09-11
(a one-hour error on a signed document that sets late-checkout fees).
Cron schedules in `vercel.json` are UTC; older comments in this repo
describing them as WITA are off by one hour.

### Cloudbeds API contracts — established by live probing 2026-09-11

These cost most of a day to find because they are NOT in the OpenAPI
spec, they contradict each other, and every failure was silent. Verified
by probing one far-future date (2 & 6 Mar 2027) and reading the result
back, not by assumption:

| Behaviour | `getRate` | `putRate` |
|---|---|---|
| `endDate` | **EXCLUSIVE** — last day is not returned | **INCLUSIVE** — `[d, d]` sets exactly one night |
| `startDate == endDate` | **REJECTED**: "Parameter endDate should be greater than startDate" | **ACCEPTED** — this is how a single night is set |

Other hard-won facts:
- **Every numeric field comes back as a STRING** (`"rate":"650000.00"`).
  A `typeof x === "number"` check drops every row, and the caller sees a
  successful response with zero data. This silently broke the entire
  rate mirror from the day it was written.
- `data` may be an object or an array of rate plans — handle both.
- The nested form encoding `rates[0][interval][0][startDate]` is
  correct; a rejection here is far more likely to come from the
  `getRate` lookup that runs immediately before the push.
- `putRate` is asynchronous: it answers `202` with a `jobReferenceID`,
  so read the rate back (after a short wait) rather than trusting the
  `success: true`.

**Rule of thumb for this integration: a Cloudbeds call that "succeeds"
with empty data is the normal failure mode. Always log the raw body and
verify by reading back.**

First successful autopilot push: 2026-09-11. Fri/Sat 750,000 (Standard)
and 850,000 (Sawah View); other days at base 650,000 / 750,000, with the
occupancy discount held back until there is real booking history.

Still open: AI competitor research fails with "AI bridge failed: 200" —
Mkhsistem's `/api/villa/ai/competitor-pricing` answers 200 without
`success: true`. Until that is fixed the engine runs on occupancy,
weekend and high-season rules only, with no market data.
