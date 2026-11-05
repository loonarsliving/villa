import type { FinanceChecklistItem } from "@/lib/types";

/**
 * Daftar payout OTA (owner 2026-11-06): Booking.com dan Agoda mengirim daftar
 * payout per booking sebelum transfer. Finance mengunggah file CSV-nya; di
 * sini kita MEMBACA (tanpa AI) dan MENCOCOKKAN per booking. Hasilnya hanya
 * usulan -- pencatatan tetap lewat tombol finance.
 *
 * Kolom CSV Booking.com dikenali dari nama header (tidak peka huruf besar,
 * spasi, atau tanda baca) karena susunan pastinya belum diverifikasi dengan
 * file asli. Kalau header wajib tidak ditemukan, pesan galat menyebut mana.
 */

export interface PayoutBaris {
  nomor: string;
  tipe: string;
  tamu: string;
  checkin: string;
  checkout: string;
  kotor: number | null;
  net: number;
  /** false untuk Adjustment/Refund dsb.: tidak dicocokkan ke booking. */
  reservasi: boolean;
}

export interface HasilBaca {
  rows: PayoutBaris[];
  /** Baris yang tidak bisa dibaca (nomor baris di file + alasan). */
  ditolak: string[];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseCsv(teks: string): string[][] {
  const t = teks.replace(/^﻿/, "");
  const barisPertama = t.split(/\r?\n/, 1)[0] ?? "";
  const hitung = (c: string) => barisPertama.split(c).length - 1;
  const pemisah = [",", ";", "\t"].reduce((a, b) => (hitung(b) > hitung(a) ? b : a));
  const out: string[][] = [];
  let baris: string[] = [];
  let sel = "";
  let kutip = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (kutip) {
      if (c === '"' && t[i + 1] === '"') {
        sel += '"';
        i++;
      } else if (c === '"') kutip = false;
      else sel += c;
    } else if (c === '"') kutip = true;
    else if (c === pemisah) {
      baris.push(sel);
      sel = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      baris.push(sel);
      sel = "";
      if (baris.some((x) => x.trim() !== "")) out.push(baris);
      baris = [];
    } else sel += c;
  }
  baris.push(sel);
  if (baris.some((x) => x.trim() !== "")) out.push(baris);
  return out;
}

/** "Rp 1,410,150", "-Rp 241,655", "1.410.150,00", "1410150.00" -> bilangan (Rupiah). */
export function parseRupiah(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  const negatif = /^\(.*\)$/.test(s) || /(^|\s)-/.test(s) || s.includes("−");
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;
  const titik = s.includes("."), koma = s.includes(",");
  if (titik && koma) {
    const desimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const ribuan = desimal === "." ? "," : ".";
    s = s.split(ribuan).join("").replace(desimal, ".");
  } else if (titik || koma) {
    const sep = titik ? "." : ",";
    const bagian = s.split(sep);
    // Rupiah: tepat 3 digit setelah pemisah = ribuan, selain itu desimal.
    const ribuan = bagian.length > 2 || bagian[bagian.length - 1].length === 3;
    s = ribuan ? bagian.join("") : bagian.join(".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (negatif ? -1 : 1) * Math.round(n);
}

const BULAN: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", mei: "05", jun: "06", jul: "07", aug: "08", agu: "08", agt: "08", sep: "09", oct: "10", okt: "10", nov: "11", dec: "12", des: "12" };

/** "Oct 31, 2026", "31 Oct 2026", "2026-10-31", "31/10/2026" -> "2026-10-31". */
export function parseTanggal(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && BULAN[m[1].toLowerCase()]) return `${m[3]}-${BULAN[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(s);
  if (m && BULAN[m[2].toLowerCase()]) return `${m[3]}-${BULAN[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  return null;
}

const ALIAS = {
  nomor: ["bookingnumber", "reservationnumber", "reservationid", "bookingid", "reservation"],
  tipe: ["type", "transactiontype"],
  tamu: ["guestname", "guest"],
  checkin: ["checkin", "checkindate", "arrival"],
  checkout: ["checkout", "checkoutdate", "departure"],
  kotor: ["amount", "grossamount", "grossbookingamount"],
  net: ["net", "netamount", "netpayout"],
} as const;

export function bacaPayoutBookingCom(teks: string): HasilBaca | { galat: string } {
  const tabel = parseCsv(teks);
  if (tabel.length < 2) return { galat: "File kosong atau tidak berisi baris data." };
  const header = tabel[0].map(norm);
  const kolom = {} as Record<keyof typeof ALIAS, number>;
  const hilang: string[] = [];
  for (const k of Object.keys(ALIAS) as (keyof typeof ALIAS)[]) {
    const i = header.findIndex((h) => (ALIAS[k] as readonly string[]).includes(h));
    if (i < 0 && k !== "tipe" && k !== "kotor") hilang.push(k);
    kolom[k] = i;
  }
  if (hilang.length) {
    return { galat: `Kolom wajib tidak ditemukan: ${hilang.join(", ")}. Header di file: ${tabel[0].join(" | ")}` };
  }
  const rows: PayoutBaris[] = [];
  const ditolak: string[] = [];
  tabel.slice(1).forEach((r, idx) => {
    const no = idx + 2;
    const nomor = (r[kolom.nomor] ?? "").trim();
    const tipe = kolom.tipe >= 0 ? (r[kolom.tipe] ?? "").trim() : "Reservation";
    const net = parseRupiah(r[kolom.net] ?? "");
    const checkin = parseTanggal(r[kolom.checkin] ?? "");
    const checkout = parseTanggal(r[kolom.checkout] ?? "");
    const reservasi = /reserv|booking/i.test(tipe) || tipe === "";
    if (!nomor || net == null || (reservasi && (!checkin || !checkout))) {
      ditolak.push(`Baris ${no}: nomor, tanggal, atau Net tidak terbaca`);
      return;
    }
    rows.push({
      nomor,
      tipe,
      tamu: (r[kolom.tamu] ?? "").trim(),
      checkin: checkin ?? "",
      checkout: checkout ?? "",
      kotor: kolom.kotor >= 0 ? parseRupiah(r[kolom.kotor] ?? "") : null,
      net,
      reservasi,
    });
  });
  return { rows, ditolak };
}

// ── Pencocokan ──────────────────────────────────────────────────────────

export type StatusPayout = "cocok_nomor" | "cocok_nama" | "sudah_masuk" | "ambigu" | "tidak_ketemu" | "duplikat" | "bukan_reservasi";

export interface HasilPayout {
  baris: PayoutBaris;
  status: StatusPayout;
  item: FinanceChecklistItem | null;
  /** Net OTA - angka seharusnya di sistem. */
  selisih: number | null;
}

function token(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[….]+$/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Nama sama, atau salah satu terpotong ("Mutiara Zalfa Pute…") / urutan berbeda. */
export function namaMirip(a: string, b: string): boolean {
  const ta = token(a), tb = token(b);
  if (!ta.length || !tb.length) return false;
  const [kecil, besar] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  // Potongan "Pute…" boleh menjadi awalan dari "Puteri" (kedua arah), minimal 3 huruf.
  const awalan = (x: string, k: string) => Math.min(x.length, k.length) >= 3 && (x.startsWith(k) || k.startsWith(x));
  return kecil.every((k, i) => besar.some((x, j) => x === k || (i === kecil.length - 1 && j === besar.length - 1 && awalan(x, k))));
}

export function cocokkanPayout(rows: PayoutBaris[], items: FinanceChecklistItem[], sumberPola: RegExp): HasilPayout[] {
  const kandidat = items.filter((i) => sumberPola.test(i.sumber ?? ""));
  const terpakai = new Set<string>();
  const sudahDilihat = new Set<string>();
  const hasil: (HasilPayout | null)[] = rows.map(() => null);

  const buat = (baris: PayoutBaris, status: StatusPayout, item: FinanceChecklistItem | null): HasilPayout => ({
    baris,
    status,
    item,
    selisih: item ? baris.net - item.seharusnya : null,
  });

  rows.forEach((b, i) => {
    if (!b.reservasi) hasil[i] = buat(b, "bukan_reservasi", null);
    else if (sudahDilihat.has(b.nomor)) hasil[i] = buat(b, "duplikat", null);
    else sudahDilihat.add(b.nomor);
  });

  // 1) nomor booking OTA yang sudah tersimpan
  rows.forEach((b, i) => {
    if (hasil[i]) return;
    const item = kandidat.find((c) => c.ota_booking_number === b.nomor && !terpakai.has(c.booking_id));
    if (item) {
      terpakai.add(item.booking_id);
      hasil[i] = buat(b, item.masuk ? "sudah_masuk" : "cocok_nomor", item);
    }
  });
  // 2) nama + check-in + check-out, hanya kalau tepat satu kandidat
  rows.forEach((b, i) => {
    if (hasil[i]) return;
    const cocok = kandidat.filter(
      (c) => !terpakai.has(c.booking_id) && !c.ota_booking_number && c.tgl_checkin === b.checkin && c.tgl_checkout === b.checkout && namaMirip(c.guest_nama, b.tamu),
    );
    if (cocok.length === 1) {
      terpakai.add(cocok[0].booking_id);
      hasil[i] = buat(b, cocok[0].masuk ? "sudah_masuk" : "cocok_nama", cocok[0]);
    } else hasil[i] = buat(b, cocok.length > 1 ? "ambigu" : "tidak_ketemu", null);
  });
  return hasil as HasilPayout[];
}
