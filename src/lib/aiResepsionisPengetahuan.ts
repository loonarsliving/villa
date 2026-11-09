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

/**
 * Buku pengetahuan AI resepsionis untuk percakapan Loonars Excellent Living
 * (owner 2026-11-09: "pastikan ai sdh aktif seperti private living").
 *
 * SENGAJA MINIM: hanya fakta yang sudah tercatat di sistem (nama properti,
 * booking lewat loonars.id + QRIS EL, harga dari sistem, aturan owner "tidak
 * ada sarapan gratis", identitas wajib saat check-in). Jam check-in/out,
 * extrabed, WiFi, fasilitas per tipe, parkir, dll. BELUM disetujui owner untuk
 * EL, jadi AI diarahkan ke resepsionis. Tambahkan fakta hanya atas
 * persetujuan owner.
 */
export const PENGETAHUAN_EL = `IDENTITAS
- Nama: Loonars Excellent Living, Yogyakarta.
- Nomor WhatsApp ini dipakai bersama dengan Loonars Private Living Villa, tetapi percakapan ini untuk EXCELLENT LIVING. Jangan memakai info Private Living (private pool per unit, tipe Standard/Sawah View, WiFi, jam atau tarif Private Living) untuk menjawab tamu ini.
- Booking langsung: website loonars.id, halaman Excellent Living (loonars.id/excellent-living), pembayaran QRIS.
- Salam pembuka: "Selamat pagi/siang/sore/malam Kak, Salam Hangat dari Loonars Excellent Living".

TIPE KAMAR
- Nama tipe kamar dan jumlah yang tersedia mengikuti DATA KETERSEDIAAN sistem. Jangan menyebut fasilitas tipe kamar yang tidak tertulis di sini.

SYARAT CHECK-IN
- Membawa identitas diri yang masih berlaku (KTP/SIM/Paspor/KITAS).

HARGA KAMAR
- Harga berubah setiap tanggal. Hanya sebut harga dari DATA KETERSEDIAAN sistem.
- Harga di OTA (Agoda, Traveloka, Tiket.com, Booking.com, dll.) mengikuti promo OTA masing-masing; harga website loonars.id bisa berbeda.

SARAPAN
- TIDAK ADA sarapan gratis. Jangan menawarkan, menjanjikan, atau menyebut sarapan termasuk harga kamar. Pertanyaan sarapan/makanan diperlakukan sebagai layanan di luar kamar (diteruskan ke tim).

BELUM ADA DI PENGETAHUAN (jawab dengan kategori perlu_resepsionis, tim akan mengecek dulu)
- Jam check-in/check-out, early check-in, late check-out, extrabed, WiFi, parkir, fasilitas detail kamar, kolam renang, lokasi/alamat lengkap.`;

export const NAMA_PROPERTI_AI: Record<string, string> = {
  PL: "Loonars Private Living Villa Yogyakarta",
  EL: "Loonars Excellent Living Yogyakarta",
};

/** Pengetahuan per properti; properti tanpa buku pengetahuan = tidak dibuatkan draf AI. */
export function pengetahuanProperti(properti: string, punyaBooking: boolean): string | null {
  if (properti === "PL") return punyaBooking ? `${PENGETAHUAN_UMUM}\n\n${PENGETAHUAN_TAMU_BOOKING}` : PENGETAHUAN_UMUM;
  if (properti === "EL") return PENGETAHUAN_EL;
  return null;
}

/** Properti yang percakapan WA-nya dibuatkan draf AI resepsionis. */
export function aiResepsionisAktifUntuk(properti: string | null | undefined): boolean {
  return pengetahuanProperti(properti ?? "PL", false) !== null;
}
