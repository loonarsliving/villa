import { jsPDF } from 'jspdf';

/**
 * Bukti Menginap untuk menginap gratis (voucher investor / kupon KOL).
 *
 * Owner 2026-11-10: investor yang menginap harus mendapat bukti yang bagus
 * "agar mereka bangga". Karena itu dokumen ini dibuat seperti sertifikat,
 * bukan invoice: tidak ada nominal rupiah sama sekali (menginap ini bukan
 * transaksi dan tidak boleh bisa dibaca sebagai kuitansi), dan tidak ada
 * tulisan "pembayaran" di mana pun.
 *
 * Datanya dari villa-api GET /public/bookings/invoice (jenis 'bukti_menginap')
 * atau GET /investor/bukti-menginap (dashboard investor).
 *
 * SALINAN dari loonars.id (repo loonars, components/booking/buktiMenginapPdf.ts)
 * supaya investor bisa mencetak dari dashboard di perangkat mana pun. Ubah
 * keduanya bersamaan agar dokumennya tetap sama.
 */
export type BuktiMenginapData = {
  jenis: 'bukti_menginap';
  kategori: 'investor' | 'kol';
  no_bukti: string;
  booking_id: string;
  unit_nomor: string;
  tipe_nama: string | null;
  guest_nama: string;
  guest_hp: string;
  tgl_checkin: string;
  tgl_checkout: string;
  durasi_malam: number;
  checkin_time: string | null;
  kode_voucher: string | null;
  /** Investor pemilik hak menginap (voucher) atau penerima kupon KOL. */
  atas_nama: string | null;
  /** Unit milik investor yang menjadi dasar kode voucher. */
  unit_investor: string | null;
  status: string;
  diterbitkan: string;
};

// Warna merek loonars.id (app/globals.css).
const HIJAU_GELAP: [number, number, number] = [18, 32, 15];
const HIJAU: [number, number, number] = [45, 77, 37];
const SAGE: [number, number, number] = [122, 158, 110];
const EMAS: [number, number, number] = [201, 168, 76];
const KRIM: [number, number, number] = [250, 247, 239];
const TINTA: [number, number, number] = [38, 42, 36];
const ABU: [number, number, number] = [118, 122, 112];

const FOTO = '/private-living-hero-poster.jpeg';

function formatTanggal(iso: string, panjang = true) {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', panjang
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

function rapikanNama(nama: string) {
  return nama.trim().replace(/\s+/g, ' ').replace(/\b\p{L}/gu, (h) => h.toUpperCase());
}

/**
 * Apakah nama yang diketik tamu adalah orang yang sama dengan pemilik hak
 * menginap. Kasus nyata pertama: tamu "Catur Budi S", akun investor "Catur
 * Budi Santosa" -- itu investornya sendiri, bukan tamu kehormatannya. Sama
 * kalau tiap kata nama yang lebih pendek adalah awalan kata yang sama posisinya
 * di nama yang lebih panjang, dan kata pertamanya utuh sama.
 */
function namaSamaOrang(a: string, b: string): boolean {
  const kata = (n: string) => n.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const x = kata(a);
  const y = kata(b);
  if (!x.length || !y.length || x[0] !== y[0]) return false;
  const [pendek, panjang] = x.length <= y.length ? [x, y] : [y, x];
  return pendek.every((k, i) => panjang[i].startsWith(k));
}

/**
 * Foto villa, sudah dipotong pas seukuran banner (rasio lebar:tinggi), sebagai
 * data URL JPEG. null kalau gagal dimuat -- PDF tetap jadi, tanpa foto.
 *
 * Digambar ulang lewat canvas, bukan langsung file aslinya: pembaca JPEG
 * jsPDF salah membaca header file poster ini (hasil ekspor ffmpeg) dan
 * menghasilkan gambar 1281x1 piksel yang rusak. Canvas juga memperkecil
 * ukurannya, jadi PDF-nya tetap ringan untuk dikirim lewat WhatsApp.
 */
async function muatFoto(rasio: number): Promise<string | null> {
  try {
    const res = await fetch(FOTO);
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    try {
      const img = await new Promise<HTMLImageElement>((ok, gagal) => {
        const el = new Image();
        el.onload = () => ok(el);
        el.onerror = () => gagal(new Error('foto'));
        el.src = url;
      });
      const lebar = 1240;
      const tinggi = Math.round(lebar / rasio);
      const canvas = document.createElement('canvas');
      canvas.width = lebar;
      canvas.height = tinggi;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // "cover": isi penuh, potong kelebihan di tengah.
      const skala = Math.max(lebar / img.naturalWidth, tinggi / img.naturalHeight);
      const w = img.naturalWidth * skala;
      const h = img.naturalHeight * skala;
      ctx.drawImage(img, (lebar - w) / 2, (tinggi - h) / 2, w, h);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

export async function buildBuktiMenginapPdf(data: BuktiMenginapData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();   // 210
  const H = doc.internal.pageSize.getHeight();  // 297
  const tengah = W / 2;
  const isInvestor = data.kategori === 'investor';
  const pemilik = data.atas_nama ? rapikanNama(data.atas_nama) : null;
  const tamuAdalahPemilik = !!pemilik && namaSamaOrang(data.guest_nama || '', pemilik);
  // Investor sering mengetik namanya disingkat ("Catur Budi S") padahal nama
  // akunnya lengkap ("Catur Budi Santosa"): tampilkan yang lengkap.
  const tamu = tamuAdalahPemilik ? pemilik! : rapikanNama(data.guest_nama || '-');

  // ---- Latar kertas ----
  doc.setFillColor(...KRIM);
  doc.rect(0, 0, W, H, 'F');

  // ---- Banner foto villa dengan lapisan hijau gelap ----
  const tinggiBanner = 92;
  const foto = await muatFoto(W / tinggiBanner);
  if (foto) doc.addImage(foto, 'JPEG', 0, 0, W, tinggiBanner);
  const GState = (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
  const setGState = (doc as unknown as { setGState: (g: unknown) => void }).setGState.bind(doc);
  setGState(new GState({ opacity: foto ? 0.72 : 1 }));
  doc.setFillColor(...HIJAU_GELAP);
  doc.rect(0, 0, W, tinggiBanner, 'F');
  setGState(new GState({ opacity: 1 }));
  // Garis emas di kaki banner.
  doc.setFillColor(...EMAS);
  doc.rect(0, tinggiBanner, W, 1.2, 'F');

  // Teks banner.
  doc.setTextColor(...EMAS);
  doc.setFont('times', 'bold');
  doc.setFontSize(34);
  doc.text('L O O N A R S', tengah, 34, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(235, 230, 214);
  doc.text('P R I V A T E   L I V I N G', tengah, 42, { align: 'center' });

  doc.setDrawColor(...EMAS);
  doc.setLineWidth(0.3);
  doc.line(tengah - 32, 52, tengah - 6, 52);
  doc.line(tengah + 6, 52, tengah + 32, 52);
  doc.setFillColor(...EMAS);
  // Belah ketupat kecil di tengah garis.
  doc.triangle(tengah - 2.2, 52, tengah, 49.8, tengah + 2.2, 52, 'F');
  doc.triangle(tengah - 2.2, 52, tengah, 54.2, tengah + 2.2, 52, 'F');

  doc.setFont('times', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text('BUKTI MENGINAP', tengah, 67, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...EMAS);
  doc.text(isInvestor ? 'PRIORITY INVESTOR STAY' : 'TAMU UNDANGAN LOONARS', tengah, 76, { align: 'center' });

  // ---- Bingkai emas ganda di badan dokumen ----
  doc.setDrawColor(...EMAS);
  doc.setLineWidth(0.6);
  doc.rect(10, tinggiBanner + 7, W - 20, H - tinggiBanner - 31);
  doc.setLineWidth(0.2);
  doc.rect(12, tinggiBanner + 9, W - 24, H - tinggiBanner - 35);

  // ---- Nama tamu ----
  let y = tinggiBanner + 21;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...ABU);
  doc.text(isInvestor ? 'Dengan bangga kami menyambut' : 'Dengan senang hati kami menyambut', tengah, y, { align: 'center' });

  y += 14;
  doc.setFont('times', 'bolditalic');
  let ukuranNama = 30;
  doc.setFontSize(ukuranNama);
  while (doc.getTextWidth(tamu) > W - 50 && ukuranNama > 18) {
    ukuranNama -= 1;
    doc.setFontSize(ukuranNama);
  }
  doc.setTextColor(...HIJAU);
  doc.text(tamu, tengah, y, { align: 'center' });

  y += 9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...EMAS);
  let keterangan: string;
  if (isInvestor) {
    keterangan = tamuAdalahPemilik || !pemilik
      ? `Investor Loonars Private Living${data.unit_investor ? `  ·  Pemilik Unit ${data.unit_investor}` : ''}`
      : `Tamu kehormatan investor ${pemilik}${data.unit_investor ? ` (Unit ${data.unit_investor})` : ''}`;
  } else {
    keterangan = 'Tamu undangan Loonars Private Living';
  }
  doc.text(keterangan, tengah, y, { align: 'center', maxWidth: W - 44 });

  // ---- Kartu detail menginap ----
  y += 12;
  const kartuX = 24;
  const kartuW = W - 48;
  const kartuH = 74;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 219, 199);
  doc.setLineWidth(0.3);
  doc.roundedRect(kartuX, y, kartuW, kartuH, 3, 3, 'FD');
  // Pita hijau di kiri kartu.
  doc.setFillColor(...HIJAU);
  doc.roundedRect(kartuX, y, 3, kartuH, 1.5, 1.5, 'F');

  const kolomKiri = kartuX + 11;
  const kolomKanan = kartuX + kartuW / 2 + 4;
  const isiKartu: [string, string, string | null][][] = [
    [
      ['UNIT', data.unit_nomor, data.tipe_nama],
      ['DURASI', `${data.durasi_malam} malam`, null],
    ],
    [
      ['CHECK-IN', formatTanggal(data.tgl_checkin, false), data.checkin_time ? `mulai pukul ${data.checkin_time}` : null],
      ['CHECK-OUT', formatTanggal(data.tgl_checkout, false), null],
    ],
    [
      [isInvestor ? 'KODE HAK MENGINAP' : 'KODE UNDANGAN', data.kode_voucher ?? '-', null],
      ['NO. BUKTI', data.no_bukti, `Reservasi ${data.booking_id.slice(0, 8).toUpperCase()}`],
    ],
  ];
  let yBaris = y + 12;
  for (const baris of isiKartu) {
    baris.forEach(([label, nilai, sub], i) => {
      const x = i === 0 ? kolomKiri : kolomKanan;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...SAGE);
      doc.text(label, x, yBaris);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...TINTA);
      doc.text(nilai, x, yBaris + 6.5);
      if (sub) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...ABU);
        doc.text(sub, x, yBaris + 11.5);
      }
    });
    yBaris += 22;
  }
  // Garis pemisah kolom.
  doc.setDrawColor(236, 231, 216);
  doc.line(kartuX + kartuW / 2 - 2, y + 7, kartuX + kartuW / 2 - 2, y + kartuH - 7);

  // ---- Segel ----
  y += kartuH + 13;
  const segelX = W - 46;
  const segelY = y + 10;
  doc.setDrawColor(...EMAS);
  doc.setLineWidth(1);
  doc.circle(segelX, segelY, 15, 'S');
  doc.setLineWidth(0.3);
  doc.circle(segelX, segelY, 12.5, 'S');
  doc.setFont('times', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...EMAS);
  doc.text('L', segelX, segelY - 1.5, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.text(isInvestor ? 'PRIORITY' : 'INVITED', segelX, segelY + 3.5, { align: 'center' });
  doc.text(isInvestor ? 'INVESTOR' : 'GUEST', segelX, segelY + 6.5, { align: 'center' });

  // ---- Pesan ----
  doc.setFont('times', 'italic');
  doc.setFontSize(12);
  doc.setTextColor(...HIJAU);
  const pesan = isInvestor
    ? 'Terima kasih telah menjadi bagian dari perjalanan Loonars. Unit ini telah kami siapkan khusus untuk Anda. Selamat menikmati rumah Anda sendiri.'
    : 'Terima kasih telah berkolaborasi bersama Loonars. Unit ini telah kami siapkan khusus untuk Anda. Selamat menikmati masa menginap Anda.';
  doc.text(pesan, 26, y + 2, { maxWidth: segelX - 26 - 22, lineHeightFactor: 1.45 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...ABU);
  doc.text('Tunjukkan bukti ini kepada tim front desk saat check-in.', 26, y + 24);
  doc.text(`Diterbitkan ${formatTanggal(data.diterbitkan.slice(0, 10), false)}  ·  Status: Terkonfirmasi`, 26, y + 29);

  // ---- Kaki halaman ----
  doc.setFillColor(...HIJAU_GELAP);
  doc.rect(0, H - 18, W, 18, 'F');
  doc.setFillColor(...EMAS);
  doc.rect(0, H - 18, W, 0.8, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(235, 230, 214);
  doc.text('loonars.id   ·   WhatsApp +62 822-2888-5223', tengah, H - 10.5, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(...SAGE);
  doc.text('Dokumen ini adalah bukti menginap, bukan tagihan maupun kuitansi.', tengah, H - 5.5, { align: 'center' });

  return doc;
}
