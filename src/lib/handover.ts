/**
 * Ringkasan pergantian shift Front Desk (owner 2026-10-13): siapa yang
 * menginap, check-out, dan check-in hari ini -- pengganti laporan manual
 * "Jadwal Check-In Guest" yang selama ini diketik resepsionis di grup WA.
 *
 * Murni dari baris bookings yang dibaca halaman Front Desk (GET /bookings
 * dengan rentang kemarin..besok); tidak ada rumus atau data baru.
 */

export type HandoverBooking = {
  id: string;
  unit_id: string | null;
  unit_nomor: string | null;
  guest_nama: string;
  tgl_checkin: string;
  tgl_checkout: string | null;
  status: string;
  sumber?: string | null;
  paket_dekorasi?: string | null;
};

export type HandoverItem = HandoverBooking & {
  /** Keterangan singkat keadaan hari ini, mis. "Belum datang". */
  keadaan: string;
};

export type Handover = {
  inHouse: HandoverItem[];
  checkout: HandoverItem[];
  checkin: HandoverItem[];
};

const AKTIF = new Set(["terjadwal", "checkin", "checkout"]);

const urutUnit = (a: HandoverBooking, b: HandoverBooking) =>
  (a.unit_nomor ?? "").localeCompare(b.unit_nomor ?? "", "id", { numeric: true });

export function buildHandover(bookings: HandoverBooking[], hariIni: string): Handover {
  const inHouse: HandoverItem[] = [];
  const checkout: HandoverItem[] = [];
  const checkin: HandoverItem[] = [];
  for (const b of bookings) {
    if (!AKTIF.has(b.status)) continue;
    const keluar = b.tgl_checkout;
    if (keluar === hariIni) {
      checkout.push({
        ...b,
        keadaan: b.status === "checkout" ? "Sudah check-out" : b.status === "terjadwal" ? "Tidak datang" : "Belum check-out",
      });
    } else if (b.tgl_checkin === hariIni) {
      checkin.push({ ...b, keadaan: b.status === "checkin" ? "Sudah check-in" : "Belum datang" });
    } else if (b.tgl_checkin < hariIni && (!keluar || keluar > hariIni)) {
      if (b.status === "checkout") continue; // pulang lebih awal
      inHouse.push({ ...b, keadaan: b.status === "checkin" ? "Menginap" : "Terlambat, belum datang" });
    }
  }
  return { inHouse: inHouse.sort(urutUnit), checkout: checkout.sort(urutUnit), checkin: checkin.sort(urutUnit) };
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "12-14 Okt", atau "30 Okt - 2 Nov" bila beda bulan. */
export function rentangTanggal(masuk: string, keluar: string | null): string {
  const [, m1, d1] = masuk.split("-").map(Number);
  if (!keluar) return `${d1} ${BULAN[m1 - 1]}`;
  const [, m2, d2] = keluar.split("-").map(Number);
  return m1 === m2 ? `${d1}-${d2} ${BULAN[m1 - 1]}` : `${d1} ${BULAN[m1 - 1]} - ${d2} ${BULAN[m2 - 1]}`;
}

/** Teks siap tempel ke grup WA, mengikuti format laporan manual yang lama. */
export function handoverText(h: Handover, judulTanggal: string): string {
  const blok = (judul: string, items: HandoverItem[]) => {
    const isi = items.length
      ? items
          .map((b) => `Tanggal ${rentangTanggal(b.tgl_checkin, b.tgl_checkout)}\n${b.guest_nama} (${b.unit_nomor ?? "-"})${
            b.keadaan !== "Menginap" ? ` — ${b.keadaan}` : ""
          }${b.paket_dekorasi ? `\n🎉 ${b.paket_dekorasi}` : ""}`)
          .join("\n\n")
      : "-";
    return `*${judul}*\n${isi}`;
  };
  return [
    `*Jadwal Check-In Guest — ${judulTanggal}*`,
    blok("In House", h.inHouse),
    "———",
    blok("Check-out", h.checkout),
    "———",
    blok("Check-in", h.checkin),
  ].join("\n\n");
}
