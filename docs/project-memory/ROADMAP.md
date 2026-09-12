# ROADMAP.md

No formal roadmap document, issue tracker export, or TODO-comment backlog exists in this repository. This file is built exclusively from what unmerged branches and commit messages imply was planned/in-progress work — nothing here is invented.

## COMPLETED (on `main`)
- Migration from static HTML dashboard to Next.js App Router.
- Role-based dashboards for receptionist (Front Desk), admin, and investor (owner).
- Cloudbeds channel-manager webhook integration (moved to Vercel Route Handler).
- Double-booking-by-date prevention on Front Desk.
- Admin panel: user management, staff management, investor listing, Cloudbeds mapping, WhatsApp send log viewer.
- UI redesign to a light, colorful mobile-style theme.
- First-login forced password change + investor profile completion flow.

## IN PROGRESS (unmerged branches exist)
- Next.js 15.1 → 16.3.1 upgrade to close known postcss/sharp CVEs (`claude/security-3-repos-tj69ek`, commit `341ac2f`).
- Cloudbeds webhook payload validation hardening (`claude/security-3-repos-tj69ek`, commit `a6c853b`).
- Server-side proxy to harden client-side role gating (`claude/security-3-repos-tj69ek`, commit `1657dfb`).
- AI CCTV checkpoint module: EZVIZ snapshot capture + Gemini Vision person-presence detection, routed through a sibling "Mkhsistem" system's AI bridge (`claude/frigate-ai-cctv-module-eqwuri`, commits `db248d5`, `b2fa553`).

## NEXT
UNKNOWN — NEEDS CONFIRMATION. No prioritized "next up" list exists in the repository; the branches above represent the closest available signal of near-term intent, and their order of landing is not documented anywhere.

## PLANNED
UNKNOWN — NEEDS CONFIRMATION. A handful of other `claude/*` branches exist (`file-hub-repo-integration`, `repo-overview`, `security-audit-repos`, `tampilan-design-request`, `villa-system-no-receptionist`) whose branch names suggest topics (file hub, another repo-overview/audit, additional security review, a design request, and a "no receptionist" system variant) but whose content was outside this audit's deep-dive scope. Their existence is evidence of exploratory/candidate work, not a confirmed plan.

## PLANNED (eksplisit, dari owner, 2026-09-12) — dua pekerjaan berikutnya

Dicatat atas permintaan owner sendiri ("saya ingin km catat baik2 ini besok kt
akan lanjutkan"). Belum ada kode apa pun untuk keduanya.

### 1. Kode menginap gratis untuk investor

Kata-kata owner: *"kt akan buat kode referal gratis untuk investor, karna ke 13
investor ini punya 12 poin mnginap gratis selama setahun, dan berlaku sebulan
sekali, kemudian tidak bisa di pakai di weekedn highseason, jd nti km akan
buatkan 12 kode referal yg akan tampil di dashboard mereka, dan itu akan
trcoret jika sdh tepakai itu smua otomatis, dia bisa input kode itu tentu di
pemesanan loonars.id"*.

Bentuknya yang diminta:
- 12 kode per investor, berlaku setahun, satu kali pakai per kode.
- Hanya boleh dipakai **sebulan sekali**.
- **Tidak berlaku di weekend/high season** (lihat pertanyaan terbuka di bawah).
- Tampil di dashboard investor, dan **tercoret sendiri** begitu terpakai.
- Ditukarkan oleh investor lewat form pemesanan di loonars.id.

Catatan penamaan: owner menyebutnya "kode referal", tapi yang dijelaskannya
adalah **voucher penukaran menginap gratis** (dipakai investor itu sendiri),
bukan kode referal yang dibagikan ke orang lain. Bangun sesuai perilakunya,
bukan sesuai namanya — dan tanyakan lagi kalau maksudnya ternyata dibagikan.

**Fakta yang sudah diperiksa (2026-09-12), jangan diulang:**
- **"13 investor" cocok dengan `villa_users` role `owner` yang aktif: 16 baris,
  13 aktif.** Investor login memakai role `owner`, bukan role bernama
  "investor" (role `investor` tidak ada sama sekali).
- **`investor_profiles` hanya berisi 11 baris** — kolomnya: `id, unit_id,
  unit_nomor, user_id, nama, hp, created_at, bank_nama, no_rekening,
  nama_pemilik_rekening`. Jadi 13 investor vs 11 profil **tidak cocok**.
  Selesaikan ini DULU: membuat 12 kode dari `investor_profiles` akan
  menghasilkan 132 kode dan **melewatkan 2 investor**.
- `villa_high_season_periods` ada dan berisi **5 periode aktif**, jadi aturan
  "tidak berlaku di high season" sudah punya sumber data; tidak perlu tabel
  baru untuk itu.
- Dashboard investor sudah ada: `src/app/investor/` (`page`, `laporan`,
  `opex`, `pendapatan`, `profil`, `notifikasi`).

**JAWABAN OWNER (2026-09-12) — aturan mainnya sudah pasti:**

1. **Weekend dan high season adalah DUA larangan terpisah.** Kode tidak bisa
   dipakai di weekend mana pun, DAN tidak bisa dipakai di high season mana pun.
   Bukan "weekend yang jatuh di high season".
2. **Weekend = Jumat, Sabtu, Minggu** (tiga hari, bukan dua).
3. **Satu kode = satu bulan kalender.** Kode mulai berlaku **Oktober**, jadi 12
   kode = Okt 2026 s/d Sep 2027, satu kode per bulan. Kode yang tidak dipakai
   sampai bulannya lewat **hangus**, otomatis **tercoret di dashboard**, dan
   tidak bisa dipakai lagi. Jadi "tercoret" punya dua sebab: sudah terpakai,
   atau bulannya sudah lewat.
4. 12 poin setahun, maksimal satu kali per bulan.

**Pemakaian kode gratis TIDAK masuk ke mana-mana** (kata owner: *"otomatis
tidak trcatat di cloudbeds, laporan keuangan, rumus deviden smua tidak masuk,
dia hanya akan langsung keep di kalender booking"*):
- tidak didorong ke Cloudbeds,
- tidak masuk laporan keuangan,
- tidak masuk rumus dividen,
- **hanya** mengunci unit di kalender booking villa.

Artinya rumus keuangan yang dibekukan di `PHASE0-BASELINE.md` §2 tidak perlu
diubah sama sekali — yang perlu dipastikan adalah baris booking ini punya
PENANDA yang jelas, lalu setiap kueri pendapatan/dividen mengecualikannya.
Penanda itu harus ada sejak baris pertama dibuat, bukan ditambahkan belakangan.

**KEPUTUSAN AKHIR OWNER (2026-09-12), setelah risikonya disampaikan:**
*"Betul brrti ttp masuk cloudbeds, tpi tidak masuk hitungan okupansi"*.

Jadi malam gratis investor:
- **TETAP didorong ke Cloudbeds** — unitnya diblokir supaya OTA berhenti
  menjualnya. Ini memperbaiki jawaban owner sebelumnya ("tidak trcatat di
  cloudbeds") setelah risiko tabrakan dengan tamu berbayar dijelaskan.
- **TIDAK masuk laporan keuangan, rumus dividen, maupun hitungan okupansi.**

**Ini bagian tersulit dari seluruh fitur, dan alasannya bukan Cloudbeds:**
okupansi dihitung ULANG secara terpisah di **11 tempat**, masing-masing dengan
kuerinya sendiri ke tabel `bookings`:

| Berkas | Peran |
|---|---|
| `src/lib/aiPricingEngine.ts` | sinyal permintaan untuk keputusan harga |
| `src/lib/aiDynamicPricingRun.ts` | eksekusi harga harian |
| `src/lib/aiBridge.ts` | okupansi yang dikirim ke AI |
| `src/app/api/admin/pricing-insight/route.ts` | |
| `src/app/api/admin/occupancy-forecast/route.ts` | |
| `src/app/api/admin/pricing-calendar/route.ts` | |
| `src/app/api/admin/revenue-metrics/route.ts` | |
| `src/app/api/cron/daily-inventory-snapshot/route.ts` | rekaman historis |
| `src/app/api/cron/generate-pricing-recommendations/route.ts` | |
| villa-api `/bridge/occupancy` | kartu okupansi front-desk & AI |
| villa-api `/cron/promo-low-season` | ambang low season untuk promo |

Kalau satu saja terlewat, angkanya akan berbeda-beda **tanpa satu pun pesan
galat** — dan yang terlewat itu bisa jadi justru mesin harga. Karena itu
pengecualiannya harus lewat SATU penanda yang disaring di satu tempat bersama,
bukan ditempel satu per satu di sebelas kueri.

**Yang masih perlu ditanyakan ke owner:** "tidak masuk hitungan okupansi" itu
untuk keputusan harga/promo saja, atau juga untuk kartu okupansi yang dilihat
staf di front desk? Dugaan saya yang pertama — staf tetap harus melihat unit
itu TERISI, kalau tidak mereka mengira unitnya kosong padahal ada investor di
dalamnya. Jangan diputuskan sendiri tanpa bertanya.

### 2. WhatsApp API sendiri untuk repo villa

Kata-kata owner: *"saya berniat menyiapkn 1 whatsapp api baru khusus untuk repo
villa agar tidak perlu memanggil mkhsistem lagi hanya untuk wa"*, dan menyusul:
*"kt akan coba whastapp api mengganti semua proses yg menggunakan wa di repo
villa dan loonars"*.

**Cakupannya dua repo, dan Mkhsistem TIDAK ikut** (owner 2026-09-12: *"yg saya
buat sndiri hanya repo villa dan repo loonars, bukan mkhsistem yg sdh punay
sistem lengkap"*). Mkhsistem tetap memakai sistem WhatsApp-nya sendiri; yang
diputus hanyalah ketergantungan villa/loonars padanya.

**Konsekuensi yang mudah terlewat:** memutus villa dari Mkhsistem berarti
`lib/ai/domains/villa-payment-confirmation.ts` dan `villa-promo-campaign.ts`
di Mkhsistem — beserta cabangnya di `webhook-handler.ts` — menjadi kode mati
yang harus dicabut, BUKAN dibiarkan. Kalau dibiarkan, dua sistem akan sama-sama
menanggapi balasan "LUNAS"/"PROMO" yang sama.

**Cakupannya dua repo, bukan satu:** villa DAN loonars. Di loonars, WhatsApp
saat ini hanya berupa tautan `wa.me/6282228885223` (tombol chat mengambang,
"Kirim Bukti Pembayaran", "Konsultasi") — itu tautan biasa, bukan API, jadi
yang berubah di sana kemungkinan cuma nomornya. Periksa ulang sebelum
mengasumsikan ada pemanggilan API di loonars.

Keadaan sekarang — **dua arah** lewat Mkhsistem, dan keduanya harus pindah,
bukan cuma yang keluar:
- **Keluar:** `sendWa()` di villa-api POST ke
  `integration_settings.vercel_bridge.base_url` + `/api/wa/send` milik
  Mkhsistem. Dipakai oleh: notifikasi booking website, pesan `LUNAS` ke owner,
  pengingat kebersihan, daftar transfer dividen, dan pengiriman promo.
- **Masuk (mudah terlewat):** balasan WhatsApp `LUNAS`, `PROMO`, `TOLAK`,
  `BERHENTI` dikenali oleh `lib/ai/webhook-handler.ts` **milik Mkhsistem**, lalu
  memanggil balik villa-api lewat `/bridge/*`. Melepas Mkhsistem berarti villa
  butuh penerima webhook WhatsApp-nya sendiri. Kalau hanya sisi keluar yang
  dipindah, konfirmasi pembayaran owner akan berhenti bekerja tanpa pesan galat
  apa pun.
- Nomor WhatsApp-nya sendiri juga perlu diputuskan: nomor baru untuk villa,
  atau nomor yang sama pindah penyedia (memindahkan nomor memutus riwayat chat
  dan sesi perangkat).

**Belum pernah dibuktikan sampai sekarang:** jalur balasan WhatsApp (`LUNAS`
maupun `PROMO`) belum pernah diuji manusia satu kali pun. Batch `1DE5AA`
disiapkan berisi hanya nomor owner untuk membuktikannya. Buktikan jalur lama
bekerja SEBELUM menggantinya — kalau tidak, saat yang baru gagal, tidak ada cara
mengetahui apakah itu karena penggantinya atau karena jalur itu memang tidak
pernah hidup.

## PLANNED (explicit, from owner, 2026-08-27)
- **KTP OCR + Filemanager (Ultron) integration** — Tahap 2/3 of the Check-In Card work. Tahap 1 (photo capture + digital signature, stored in villa's own private `guest-documents` Supabase bucket) is DONE. Not yet built: (a) an AI OCR endpoint on Mkhsistem (their existing Gemini client, no such endpoint exists there yet — confirmed by reading Mkhsistem's `app/api` tree 2026-08-27) that reads a KTP photo and returns structured guest data; (b) routing the KTP photo into the separate "Filemanager"/"Ultron" app (`filemanager.haluoleo.id`, repo `loonarsliving/Filemanager`, not in villa's or this audit's repo access) for permanent storage instead of villa's own bucket. Owner's framing: "sebenarnya semua fitur itu sudah ada, nanti kita benahi" (these capabilities basically already exist elsewhere, we'll wire them up later) — but as of 2026-08-27 no such KTP-OCR or villa-facing Filemanager bridge endpoint was found to exist yet on Mkhsistem's side; this needs re-confirming directly with the owner or by reading the Filemanager repo before building, not assumed.

## UNKNOWN
- Whether the `villa-api` Supabase Edge Function (unaudited, not in this repo) has its own separate roadmap/backlog.
- Whether "Mkhsistem" is an actively developed sibling system with its own roadmap that this app's AI/WhatsApp features depend on.
- Whether a native mobile app is planned.
