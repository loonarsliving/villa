"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";

/**
 * Halaman depan bergaya aplikasi, mengikuti aplikasi Cloudbeds yang dipakai
 * owner sehari-hari (permintaan owner 14 Sep 2026, dengan tangkapan layar
 * sebagai acuan): foto besar dengan tanggal dan ring okupansi, penggeser
 * tanggal, kartu ringkas, lalu tab bar di bawah.
 *
 * DIPAKAI BERSAMA oleh beranda investor dan beranda admin. Keduanya melihat
 * angka yang sama; yang berbeda hanya isi tab bar dan kartu tambahannya.
 * Menyalin tata letaknya ke dua berkas akan membuat keduanya perlahan
 * berbeda setiap kali salah satunya disentuh.
 *
 * Terang/putih atas pilihan owner, berbeda dari gelap+emas yang dipakai
 * halaman lain. Itu memang disengaja untuk sekarang: owner memilih mengubah
 * HALAMAN DEPAN SAJA dulu supaya bisa dinilai sebelum diteruskan ke halaman
 * lain. Jadi sampai keputusan itu diambil, beranda memang akan terasa
 * berbeda dari halaman di baliknya.
 */

export interface TabItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface Ringkasan {
  tanggal: string;
  total_unit: number;
  terisi: number;
  kosong: number;
  kedatangan: number;
  keberangkatan: number;
  okupansi_persen: number;
}

const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function hariIniJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function geserHari(tanggal: string, n: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pecah(tanggal: string) {
  const d = new Date(`${tanggal}T00:00:00Z`);
  return {
    hari: NAMA_HARI[d.getUTCDay()],
    tanggal: String(d.getUTCDate()).padStart(2, "0"),
    bulan: NAMA_BULAN[d.getUTCMonth()],
    tahun: d.getUTCFullYear(),
  };
}

/** Cincin okupansi. SVG, bukan gambar: angkanya berubah tiap hari. */
function RingOkupansi({ persen, memuat }: { persen: number; memuat: boolean }) {
  const r = 46;
  const keliling = 2 * Math.PI * r;
  const terisi = Math.max(0, Math.min(100, persen));
  return (
    <div className="relative w-[112px] h-[112px] shrink-0">
      <svg viewBox="0 0 112 112" className="w-full h-full -rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="5" />
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={keliling}
          strokeDashoffset={keliling - (keliling * terisi) / 100}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <div className="text-[26px] font-light leading-none tabular-nums">{memuat ? "—" : `${terisi}%`}</div>
        <div className="text-[10px] tracking-wide opacity-80 mt-1">Okupansi</div>
      </div>
    </div>
  );
}

export function AppHome({
  tabs,
  tautanReservasi,
  children,
}: {
  tabs: TabItem[];
  /** Ke mana tombol "Lihat semua reservasi" mengarah -- berbeda per peran. */
  tautanReservasi: string;
  children?: ReactNode;
}) {
  const { user, logout, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [tanggal, setTanggal] = useState(hariIniJakarta);
  const [data, setData] = useState<Ringkasan | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    setMemuat(true);
    setGalat(null);
    api
      .get<Ringkasan>(`/dashboard/hari-ini?tanggal=${tanggal}`)
      .then((d) => {
        if (!batal) setData(d);
      })
      .catch((e: unknown) => {
        if (!batal) setGalat(e instanceof Error ? e.message : "Gagal memuat ringkasan");
      })
      .finally(() => {
        if (!batal) setMemuat(false);
      });
    return () => {
      batal = true;
    };
  }, [tanggal]);

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-xs">Memuat sesi…</div>;
  }

  const t = pecah(tanggal);
  const hariIni = tanggal === hariIniJakarta();

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Kepala berfoto. Tinggi tetap supaya ring dan tanggal tidak bergeser
          saat angkanya berubah dari "—" ke angka sungguhan. */}
      <header className="relative h-[210px] shrink-0 overflow-hidden bg-slate-900">
        {/* Gradien, bukan foto. Repo ini tidak punya folder public/, jadi
            merujuk berkas gambar hanya akan menghasilkan kotak kosong di
            produksi. Kalau nanti ada foto villa, cukup taruh di public/ dan
            pasang lewat prop -- lapisan gelap di bawah ini sudah disiapkan
            supaya teks putih tetap terbaca di atas foto seterang apa pun. */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(120% 90% at 85% 15%, #1e3a5f 0%, transparent 60%), linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #334155 100%)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-slate-900/30" />

        <div className="relative h-full flex flex-col justify-between px-5 py-4">
          <div className="flex items-start justify-between">
            <div className="w-10 h-10 rounded-full bg-white/90 text-slate-900 flex items-center justify-center text-[13px] font-semibold">
              {initials(user?.nama || "LP")}
            </div>
            <button
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="text-[11px] text-white/80 border border-white/30 rounded-full px-3 py-1.5"
            >
              Keluar
            </button>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div className="text-white">
              <div className="text-[15px] font-medium opacity-90">{t.hari}</div>
              <div className="text-[52px] leading-[0.95] font-light tracking-tight">{t.tanggal}</div>
              <div className="text-[15px] opacity-90">{t.bulan}</div>
            </div>
            <RingOkupansi persen={data?.okupansi_persen ?? 0} memuat={memuat} />
          </div>
        </div>
      </header>

      <main className="grow px-4 pt-4 pb-28">
        {/* Penggeser tanggal */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <button
            aria-label="Tanggal sebelumnya"
            onClick={() => setTanggal((v) => geserHari(v, -1))}
            className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-lg"
          >
            ‹
          </button>
          <button
            onClick={() => setTanggal(hariIniJakarta())}
            className="px-5 h-10 rounded-full bg-slate-100 text-slate-800 text-[13px] font-medium flex items-center gap-2"
          >
            <span aria-hidden>🗓</span>
            {`${t.tanggal} ${t.bulan} ${t.tahun}`}
          </button>
          <button
            aria-label="Tanggal berikutnya"
            onClick={() => setTanggal((v) => geserHari(v, 1))}
            className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-lg"
          >
            ›
          </button>
        </div>
        {!hariIni && (
          <div className="text-center text-[11px] text-slate-400 -mt-2 mb-3">
            Menampilkan tanggal lain — ketuk tanggalnya untuk kembali ke hari ini
          </div>
        )}

        {galat && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-[12px] px-4 py-3 mb-4">
            {galat}
          </div>
        )}

        {/* Aktivitas reservasi */}
        <section className="rounded-2xl border border-slate-200 overflow-hidden mb-4">
          <div className="px-4 py-3 bg-slate-50 text-[13px] font-semibold text-slate-700 flex items-center gap-2">
            <span aria-hidden>🛎</span> Aktivitas Reservasi
          </div>
          <BarisAngka label="Kedatangan" nilai={data?.kedatangan} memuat={memuat} />
          <BarisAngka label="Keberangkatan" nilai={data?.keberangkatan} memuat={memuat} />
          <BarisAngka label="Unit terisi" nilai={data?.terisi} memuat={memuat} akhir />
        </section>

        <div className="flex justify-center mb-5">
          <Link
            href={tautanReservasi}
            className="rounded-full border border-blue-600 text-blue-700 text-[13px] font-medium px-6 py-3"
          >
            Lihat semua reservasi
          </Link>
        </div>

        {children}
      </main>

      {/* Tab bar. Ditempel di bawah layar, aman terhadap area gestur iPhone. */}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around max-w-md mx-auto">
          {tabs.map((tab) => {
            const aktif = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] ${
                  aktif ? "text-blue-600" : "text-slate-400"
                }`}
              >
                <span className="text-[19px] leading-none" aria-hidden>
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            );
          })}
        </div>
        <div className="text-center text-[10px] text-slate-400 pb-1.5">Loonars Private Living</div>
      </nav>
    </div>
  );
}

function BarisAngka({
  label,
  nilai,
  memuat,
  akhir,
}: {
  label: string;
  nilai: number | undefined;
  memuat: boolean;
  akhir?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 px-4 py-3.5 ${akhir ? "" : "border-b border-slate-100"}`}>
      <div className="text-[20px] font-semibold text-slate-900 tabular-nums w-8">{memuat ? "—" : (nilai ?? 0)}</div>
      <div className="grow text-[14px] text-slate-700">{label}</div>
      {!memuat && (nilai ?? 0) === 0 && (
        <span className="w-6 h-6 rounded-full border-2 border-emerald-500 text-emerald-600 flex items-center justify-center text-[11px]">
          ✓
        </span>
      )}
    </div>
  );
}
