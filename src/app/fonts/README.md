# Font lokal

Disimpan di repo (sejak 2026-11-01) agar `next build` tidak mengambil Google
Fonts saat build. Sebelumnya `next/font/google` sesekali gagal di runner CI
GitHub (`TypeError: Cannot read properties of null (reading '1')` di
`@next/font/dist/google/loader.js`) karena jawaban Google Fonts terpotong.

Sumber: paket npm `@fontsource-variable/*` versi 5.3.0, subset `latin`, font
variabel (rentang ketebalan sudah mencakup ketebalan yang dipakai):

| File | Font | Dipakai sebagai |
| --- | --- | --- |
| `inter-latin-wght-normal.woff2` | Inter (100-900) | `--font-body` |
| `cormorant-garamond-latin-wght-normal.woff2` / `-italic` | Cormorant Garamond (300-700) | `--font-display` |
| `jetbrains-mono-latin-wght-normal.woff2` | JetBrains Mono (100-800) | `--font-mono` |

Lisensi: SIL Open Font License 1.1 (`LICENSE-*.txt`).
