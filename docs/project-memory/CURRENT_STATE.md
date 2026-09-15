# CURRENT_STATE.md

_Snapshot as of this audit: 2026-08-21, `main`@`ab473b3`._

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
