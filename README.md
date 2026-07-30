# Villa — Loonars Private Living

Aplikasi operasional villa: tiga halaman statis (di-deploy ke Vercel) di atas
satu Edge Function Supabase.

- `index.html` — login
- `receptionist.html` — operasional resepsionis (siteplan unit, booking,
  check-in/check-out, housekeeping, notifikasi)
- `owner.html` — dashboard pemilik unit (status unit, transaksi, laporan bagi
  hasil)
- `supabase/functions/villa-api/index.ts` — **satu-satunya backend**: Edge
  Function `villa-api` di project Supabase `svcmybsziaelwwdrnzcv` (project yang
  sama dengan MK Connect/Mkhsistem, tabel terpisah). Login memakai token sesi
  HMAC sendiri (`x-villa-token`), bukan Supabase Auth.

Ubah backend = edit berkas itu lalu deploy ulang function `villa-api`
(`supabase functions deploy villa-api`); berkas di repo ini adalah sumber
kebenarannya, jangan edit langsung di dashboard.

## Integrasi lewat file hub (filehub-loonars)

Villa tidak berbicara langsung dengan MK Connect. Penghubung resminya adalah
**file hub** (repo `filehub-loonars`, deploy di `filemanager.haluoleo.id`) —
dua arus:

1. **WhatsApp keluar (WhaCenter milik MK Connect).** Villa tidak memegang
   kredensial WhaCenter. Setiap kirim WA (PIN check-in, kirim manual dari
   resepsionis) berjalan:
   `villa-api → file hub POST /api/wa/send → MK Connect
   POST /api/integrations/whatsapp/bridge-send → WhaCenter`.
   Hasil kirim (sent/failed) dicatat villa-api di `wa_messages_log` dari
   balasan jembatan.
2. **Rangkuman okupansi harian tampil di MK Connect** (halaman "Okupansi
   Kos"): `MK Connect → file hub GET /api/villa/occupancy → villa-api
   GET /bridge/occupancy`. Hanya angka agregat (total/terisi/kosong/kotor,
   check-in & check-out hari ini, persentase okupansi) — tidak ada data tamu
   atau transaksi yang keluar.

### Mengaktifkan jembatan

Dua rahasia, satu per pasangan sistem. Buat dua string acak panjang (mis.
`openssl rand -hex 32`), lalu:

| Langkah | Di mana | Apa |
| --- | --- | --- |
| 1 | Vercel **file hub** | Set env `VILLA_BRIDGE_SECRET` = rahasia A, `MKHSISTEM_BRIDGE_SECRET` = rahasia B |
| 2 | Aplikasi **Villa** (login admin → Pengaturan Integrasi) | Simpan key `vercel_bridge` dengan `base_url` = `https://filemanager.haluoleo.id` dan `secret` = rahasia A |
| 3 | Vercel **MK Connect** | Set env `FILEHUB_BRIDGE_SECRET` = rahasia B (dan pastikan `WHACENTER_DEVICE_ID` terisi) |

Semua sisi **fail-closed**: selama rahasia belum disetel, kirim WA tercatat
`skipped_not_configured` (tidak error ke pengguna) dan halaman MK Connect
menampilkan "Villa belum terhubung" — tidak ada endpoint yang terbuka tanpa
rahasia.
