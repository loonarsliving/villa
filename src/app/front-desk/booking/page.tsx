"use client";

import { useEffect, useMemo, useState } from "react";
import { KalenderGrid, KalenderToolbar, DaftarHarian, RingkasanRentang, type Tampilan, type SaringStatus } from "./_Kalender";
import { AdminShell } from "../../admin/_shell";
import { FrontDeskShell } from "../_shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { fmtDate, todayISO } from "@/lib/format";
import { addDaysISO } from "@/lib/stayDates";
import { Card, CardHeader, Loading } from "@/components/Card";
import { DokumenCheckin } from "@/components/DokumenCheckin";
import { BookingBaruEl } from "@/components/BookingBaruEl";
import { usePropertiAktif } from "@/lib/properti";
import type { Booking, Unit } from "@/lib/types";



/**
 * Tanggal dulu diurai sebagai tengah malam WAKTU LOKAL, lalu diserialkan
 * ulang lewat toISOString() (UTC). Di WIB (UTC+7), tengah malam 20 Sep
 * adalah 17:00 UTC tanggal 19 Sep -- jadi addDays("2026-09-20", 0)
 * mengembalikan "2026-09-19". Kolom pertama kalender (dan semua kolom
 * setelahnya) ikut mundur satu hari dari tanggal `start` yang sebenarnya,
 * sementara batang booking diposisikan relatif terhadap tanggal aslinya --
 * hasilnya sebuah booking tampak menempel di kolom yang berlabel satu hari
 * lebih awal dari tanggal check-in-nya yang sesungguhnya.
 *
 * Dibuktikan nyata (2026-09-20): booking Cloudbeds "Ni made rai rusmala
 * Dewi" punya tgl_checkin = 2026-09-20 di database (cocok dengan reservasi
 * Cloudbeds-nya), tapi tampil di kolom "19 Sep". Diperbaiki di main lewat
 * PR #91.
 *
 * addDaysISO bekerja sepenuhnya di UTC sehingga tanggal polos tidak pernah
 * bergeser; dipakai di sini alih-alih menyalin ulang aritmetikanya, supaya
 * hanya ada satu implementasi yang diuji (src/lib/stayDates.test.ts).
 */
const addDays = addDaysISO;

function dateRange(start: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}


/**
 * How long an unpaid website booking may hold a slot on this calendar
 * before it stops being shown (owner instruction 2026-09-12, prompted by
 * a booking that had been sitting here unpaid for ten hours).
 *
 * It is only a display rule, and deliberately so: villa-api creates these
 * rows with status 'menunggu_pembayaran', which sits OUTSIDE the
 * bookings_no_overlap_active exclusion constraint -- verified against the
 * deployed function, not inferred -- so an unpaid booking never locked
 * the unit and never blocked another guest in the first place. What it
 * did do was clutter the calendar indefinitely, because the filter below
 * only ever dropped 'batal'. (villa-api's own comment claims these do not
 * appear in the staff calendar; that claim was simply wrong.)
 */
// Disamakan dengan villa-api (15 menit sejak 2026-10-08, sebelumnya 60).
const PENDING_PAYMENT_HOLD_MINUTES = 15;

function isVisibleOnCalendar(b: Booking, now: number): boolean {
  if (b.status === "batal") return false;
  if (b.status !== "menunggu_pembayaran") return true;
  const createdAt = Date.parse(b.created_at);
  if (!Number.isFinite(createdAt)) return false;
  return now - createdAt < PENDING_PAYMENT_HOLD_MINUTES * 60000;
}

/**
 * Booking calendar (Front Desk + Admin, read-only for now) -- unit rows,
 * date columns, bookings rendered as bars including Cloudbeds/OTA ones
 * (already synced into `bookings` in realtime via the Cloudbeds webhook,
 * so nothing extra needed to surface them here). Replaces the old flat
 * "50 latest bookings" list, which had no date-range/occupancy view.
 * Bars use percentage-of-container absolute positioning rather than CSS
 * Grid overlay, since grid auto-placement can't reliably stack a
 * variable-span bar on top of fixed per-day background cells in the same row.
 */
export default function BookingCalendarPage() {
  const { user } = useAuth();
  const toast = useToast();
  // Multi-properti: properti selain PL dikelompokkan per tipe (blok = kode
  // tipe kamar) dan punya form booking walk-in sendiri.
  const properti = usePropertiAktif(user);
  const [units, setUnits] = useState<Unit[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState<number>(14);
  const [start, setStart] = useState(todayISO());
  // Booking yang sedang dibuka detailnya (termasuk foto KTP & tanda tangan).
  const [dokumenBookingId, setDokumenBookingId] = useState<string | null>(null);
  const [tampilan, setTampilan] = useState<Tampilan>("kalender");
  const [cari, setCari] = useState("");
  const [saring, setSaring] = useState<SaringStatus>("semua");

  // Di HP, tampilan Daftar per hari lebih mudah dibaca daripada tabel yang
  // harus digeser ke samping. Pilihan terakhir diingat di browser ini.
  useEffect(() => {
    let awal: Tampilan | null = null;
    try {
      const t = window.localStorage.getItem("villa_kalender_tampilan");
      if (t === "kalender" || t === "daftar") awal = t;
    } catch {
      /* penyimpanan browser diblokir */
    }
    setTampilan(awal ?? (window.innerWidth < 640 ? "daftar" : "kalender"));
  }, []);
  function gantiTampilan(t: Tampilan) {
    setTampilan(t);
    try {
      window.localStorage.setItem("villa_kalender_tampilan", t);
    } catch {
      /* abaikan */
    }
  }

  const days = useMemo(() => dateRange(start, rangeDays), [start, rangeDays]);
  const end = days[days.length - 1];

  function load() {
    setLoading(true);
    Promise.all([
      api.get<Unit[]>("/units"),
      api.get<Booking[]>(`/bookings?date_from=${start}&date_to=${addDays(end, 1)}`),
    ])
      .then(([u, b]) => {
        setUnits(u || []);
        const now = Date.now();
        setBookings((b || []).filter((x) => isVisibleOnCalendar(x, now)));
      })
      .catch((e) => {
        // Tanpa ini, permintaan yang gagal hanya menghasilkan unhandled
        // rejection: kalendernya tampil KOSONG tanpa satu pun tanda bahwa
        // datanya gagal dimuat -- terbaca seperti "tidak ada booking".
        toast("⚠", "Gagal memuat kalender", e instanceof Error ? e.message : "Periksa koneksi, lalu muat ulang.", "ruby");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, start, rangeDays, properti]);

  const Shell = user?.role === "admin" ? AdminShell : FrontDeskShell;

  if (!user) {
    return (
      <Shell pageTitle="Kalender Booking">
        <Loading />
      </Shell>
    );
  }

  const bloks: string[] = properti === "PL" ? ["A", "B", "C"] : [...new Set(units.map((u) => String(u.blok)))];
  const unitLabel = properti === "PL" ? "Unit" : "Kamar";

  return (
    <Shell pageTitle="Kalender Booking" pageSub="Semua unit · termasuk booking OTA (Cloudbeds) realtime">
      <Card>
        <CardHeader
          title="Kalender"
          subtitle={`${fmtDate(start, { day: "2-digit", month: "short" })} – ${fmtDate(end, { day: "2-digit", month: "short", year: "numeric" })}`}
          action={properti !== "PL" ? <BookingBaruEl units={units} onSelesai={load} /> : undefined}
        />
        <KalenderToolbar
          start={start}
          rangeDays={rangeDays}
          onStart={setStart}
          onRange={setRangeDays}
          tampilan={tampilan}
          onTampilan={gantiTampilan}
          cari={cari}
          onCari={setCari}
          saring={saring}
          onSaring={setSaring}
          bookings={bookings}
        />
        {loading ? (
          <Loading />
        ) : (
          <>
            <RingkasanRentang bookings={bookings} days={days} totalUnit={units.length} />
            {tampilan === "kalender" ? (
              <KalenderGrid
                units={units}
                bloks={bloks}
                blokLabel={(b) => (properti === "PL" ? `Blok ${b}` : `Tipe ${b}`)}
                bookings={bookings}
                days={days}
                start={start}
                cari={cari}
                saring={saring}
                unitLabel={unitLabel}
                onBuka={setDokumenBookingId}
              />
            ) : (
              <DaftarHarian bookings={bookings} days={days} totalUnit={units.length} cari={cari} saring={saring} unitLabel={unitLabel} onBuka={setDokumenBookingId} />
            )}
          </>
        )}
      </Card>

      <DokumenCheckin bookingId={dokumenBookingId} onClose={() => setDokumenBookingId(null)} />
    </Shell>
  );
}
