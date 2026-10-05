/**
 * "Buku pengetahuan" AI resepsionis -- SATU-SATUNYA sumber fakta yang boleh
 * dipakai AI saat menyusun draf balasan WhatsApp (src/lib/aiResepsionis.ts).
 *
 * Disusun 2026-10-05 dari ±400 balasan resepsionis di wa_conversation_messages,
 * lalu DIKOREKSI owner: banyak jawaban resepsionis saling bertentangan
 * (check-in 14.00 vs 15.00, early check-in 25% vs Rp100rb vs 50%, extrabed
 * "free"), jadi yang tertulis di sini adalah keputusan owner, bukan rata-rata
 * chat. Jangan menambah fakta di sini tanpa persetujuan owner -- AI akan
 * menyampaikannya ke tamu sebagai kebenaran.
 *
 * Yang SENGAJA tidak ada: harga kamar (selalu dari villa-api per tanggal),
 * harga/isi paket di luar kamar (owner: diteruskan ke Rebecca).
 * Late check-out: Rp100.000 per jam lewat 12.00 (owner 2026-10-05).
 */

export const PENGETAHUAN_UMUM = `IDENTITAS
- Nama: Loonars Private Living Villa Yogyakarta.
- Booking langsung: website loonars.id (pembayaran QRIS).
- Salam pembuka yang biasa dipakai: "Selamat pagi/siang/sore/malam Kak, Salam Hangat dari Loonars Private Living Villa Yogyakarta".

TIPE KAMAR (semua unit punya private pool)
- Standard: unit villa dengan private pool, tanpa pemandangan sawah.
- Sawah View (sering disebut juga "Teras View"): sama seperti Standard, ditambah teras dengan pemandangan sawah.
- Fasilitas di setiap kamar: private pool, bathtub, mini kitchen, kulkas, water heater, AC, TV, WiFi, amenities.
- Extrabed: saat ini BELUM tersedia.

JAM
- Check-in mulai pukul 15.00 WIB.
- Check-out paling lambat pukul 12.00 WIB.
- Early check-in: hanya bisa mulai pukul 12.00 sampai 14.00, biaya Rp100.000, dan TERGANTUNG ketersediaan kamar hari itu (kalau sedang ramai tidak bisa). Jangan dijanjikan pasti -- sampaikan bahwa resepsionis akan mengonfirmasi di hari kedatangan. Sebelum pukul 12.00 tidak bisa.
- Late check-out (lewat pukul 12.00): dikenakan biaya Rp100.000 untuk setiap 1 jam keterlambatan, dan tergantung ketersediaan kamar (resepsionis yang mengonfirmasi). Jangan menghitung totalnya sendiri -- sebutkan tarif per jamnya saja.

SYARAT CHECK-IN
- Membawa KTP atau SIM.

HARGA KAMAR
- Harga berubah setiap tanggal. Hanya sebut harga dari DATA KETERSEDIAAN sistem.
- Harga di OTA (Agoda, Traveloka, Tiket.com, Airbnb, dll.) mengikuti promo OTA masing-masing; harga website loonars.id bisa berbeda.

PAKET & LAYANAN DI LUAR KAMAR
- BBQ/grill, honeymoon/babymoon, birthday, dekorasi kamar, floating breakfast, sarapan, makanan/minuman, sewa motor, dan sejenisnya: jangan sebut harga atau isi paket. Diteruskan ke tim (Rebecca) yang akan mengabari tamu.`;

/** Hanya disertakan untuk tamu yang sudah punya booking (menginap/terjadwal). */
export const PENGETAHUAN_TAMU_BOOKING = `KHUSUS TAMU YANG SUDAH BOOKING
- WiFi: jaringan "Loonars Villa", sandi loonarsvilla (huruf kecil semua, tanpa spasi). Sandinya sama untuk semua villa.`;
