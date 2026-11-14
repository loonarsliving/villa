"use client";

import { useState, type ReactNode } from "react";
import { AnimatedValue } from "@/components/AnimatedValue";
import { batasRapi, indeksLabel, rpRingkas } from "@/lib/vizPendapatan";

/**
 * Kit diagram bersama dashboard villa (owner 2026-11-14: semua halaman memakai
 * gaya yang sama dengan halaman Pendapatan & Channel). MURNI TAMPILAN:
 * komponen di sini hanya menggambar angka yang diberikan pemanggil, tidak
 * pernah menghitung angka keuangan sendiri.
 *
 * Aturan gaya (skill dataviz): batang <= 24px dengan ujung membulat 4px dan
 * pangkal persegi, celah 2px antarsegmen, kisi garis tipis, label selektif
 * (hanya puncak), tooltip saat hover/fokus/ketuk, teks memakai warna tinta
 * (bukan warna seri). Satu seri = satu warna (terakota), tanpa legenda.
 */

export const WARNA_UTAMA = "#b4693f";
export const WARNA_KEDUA = "#2b7bb0";

// ── Saklar (segmented control) ─────────────────────────────────────────────

export function Saklar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`inline-flex items-center gap-0.5 p-0.5 rounded-full border border-ink/10 bg-canvas/70 ${className}`}>{children}</div>;
}

export function Tombol({ aktif, onClick, children }: { aktif: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aktif}
      className={`px-2.5 py-1 rounded-full text-[10.5px] font-medium transition-colors whitespace-nowrap ${
        aktif ? "bg-forest text-cream shadow-sm" : "text-ink/55 hover:text-ink hover:bg-ink/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}

export function Swatch({ warna, className = "" }: { warna: string; className?: string }) {
  return <span aria-hidden className={`inline-block w-2.5 h-2.5 rounded-[3px] shrink-0 ${className}`} style={{ background: warna }} />;
}

// ── Angka ringkasan ────────────────────────────────────────────────────────

export function AngkaRingkas({
  label,
  nilai,
  kecil,
  tone,
}: {
  label: string;
  nilai: string;
  kecil?: ReactNode;
  tone?: "ruby" | "sage" | "gold";
}) {
  const warna = tone === "ruby" ? "text-ruby-500" : tone === "sage" ? "text-sage-600" : tone === "gold" ? "text-gold-600" : "text-ink";
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink/45 leading-snug">{label}</div>
      <div className={`mt-0.5 text-[15px] sm:text-[17px] font-semibold leading-tight ${warna}`}>
        <AnimatedValue value={nilai} durasi={900} />
      </div>
      {kecil && <div className="text-[10px] text-ink/45 mt-0.5">{kecil}</div>}
    </div>
  );
}

export function BarisRingkas({ children, kolom = 4 }: { children: ReactNode; kolom?: 2 | 3 | 4 }) {
  const k = kolom === 4 ? "sm:grid-cols-4" : kolom === 3 ? "sm:grid-cols-3" : "";
  return <div className={`grid grid-cols-2 ${k} gap-x-4 gap-y-3`}>{children}</div>;
}

// ── Meter (porsi terisi dari total) ────────────────────────────────────────

export function Meter({ nilai, maks, warna = WARNA_UTAMA, label }: { nilai: number; maks: number; warna?: string; label?: string }) {
  const p = maks > 0 ? Math.max(0, Math.min(1, nilai / maks)) : 0;
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: `${warna}26` }} role="meter" aria-valuemin={0} aria-valuemax={maks} aria-valuenow={nilai} aria-label={label}>
      <div className="h-full rounded-full viz-tumbuh-x" style={{ width: `${p * 100}%`, background: warna }} />
    </div>
  );
}

// ── Perbandingan dua periode (batang berpasangan, skala per metrik) ────────

export type BarisBanding = { label: string; kini: number | null; lalu: number | null; tampil: (n: number | null) => string; naikBaik?: boolean };

export function PerbandinganPeriode({ baris, labelKini = "Periode ini", labelLalu = "Periode sebelumnya" }: { baris: BarisBanding[]; labelKini?: string; labelLalu?: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 mb-3 text-[10.5px] text-ink/60">
        <span className="inline-flex items-center gap-1.5">
          <Swatch warna={WARNA_UTAMA} /> {labelKini}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch warna="rgba(43,38,32,0.22)" /> {labelLalu}
        </span>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3.5">
        {baris.map((b, i) => {
          const maks = Math.max(b.kini ?? 0, b.lalu ?? 0, 0);
          const lebar = (v: number | null) => (maks > 0 && v !== null ? Math.max(1.5, (v / maks) * 100) : 0);
          const selisih = b.kini !== null && b.lalu !== null ? b.kini - b.lalu : null;
          const baik = selisih === null || selisih === 0 ? null : (selisih > 0) === (b.naikBaik ?? true);
          return (
            <div key={b.label} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink/60 truncate">{b.label}</span>
                <span className="text-[12.5px] font-semibold text-ink tabular-nums whitespace-nowrap">{b.tampil(b.kini)}</span>
              </div>
              <div className="mt-1 space-y-[3px]">
                <div className="h-2 rounded-r-[4px] viz-tumbuh-x" style={{ width: `${lebar(b.kini)}%`, background: WARNA_UTAMA, animationDelay: `${0.05 * i}s` }} />
                <div className="h-2 rounded-r-[4px] viz-tumbuh-x" style={{ width: `${lebar(b.lalu)}%`, background: "rgba(43,38,32,0.22)", animationDelay: `${0.05 * i + 0.08}s` }} />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-ink/45 tabular-nums">
                <span>sebelumnya {b.tampil(b.lalu)}</span>
                {baik !== null && <span className={baik ? "text-sage-600" : "text-ruby-500"}>{selisih! > 0 ? "▲ naik" : "▼ turun"}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Batang porsi (satu keseluruhan dibagi bagian) ──────────────────────────

export type Bagian = { nama: string; nilai: number; warna: string };

export function BatangPorsi({ bagian, judul }: { bagian: Bagian[]; judul?: string }) {
  const [aktif, setAktif] = useState<string | null>(null);
  const isi = bagian.filter((b) => b.nilai > 0);
  const total = isi.reduce((s, b) => s + b.nilai, 0);
  if (!(total > 0)) return null;
  const pct = (v: number) => {
    const p = (v / total) * 100;
    return p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
  return (
    <div>
      {judul && <div className="text-[10.5px] text-ink/50 mb-1.5">{judul}</div>}
      <div className="flex h-7 w-full gap-[2px] viz-tumbuh-x" role="img" aria-label={`${judul ?? "Porsi"}: ${isi.map((b) => `${b.nama} ${pct(b.nilai)}`).join(", ")}`}>
        {isi.map((b) => {
          const lebar = (b.nilai / total) * 100;
          return (
            <div
              key={b.nama}
              className="h-full rounded-[4px] flex items-center transition-opacity duration-300"
              style={{ width: `${lebar}%`, background: b.warna, opacity: aktif && aktif !== b.nama ? 0.35 : 1 }}
              onPointerEnter={() => setAktif(b.nama)}
              onPointerLeave={() => setAktif(null)}
              title={`${b.nama}: ${pct(b.nilai)}`}
            >
              {lebar >= 13 && <span className="pl-2 text-[10.5px] font-semibold tabular-nums text-white">{pct(b.nilai)}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2">
        {isi.map((b) => (
          <span key={b.nama} className="inline-flex items-center gap-1.5 text-[10.5px] text-ink/65">
            <Swatch warna={b.warna} />
            {b.nama}
            {(b.nilai / total) * 100 < 13 && <span className="text-ink/45 tabular-nums">{pct(b.nilai)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Diagram kolom (satu seri atau bertumpuk) ───────────────────────────────

export type Kolom = {
  kunci: string;
  /** Label pendek di sumbu-x. */
  label: string;
  /** Judul tooltip. */
  judul?: string;
  /** Satu seri: satu segmen. Bertumpuk: urutan dari bawah. null = tidak ada data. */
  segmen: { nama: string; nilai: number; warna: string }[] | null;
  /** Kolom ditampilkan pudar (mis. bulan berjalan / sementara). */
  pudar?: boolean;
  /** Baris tambahan di tooltip. */
  catatan?: string;
  /** Teks nilai utama di tooltip/aria bila berbeda dari tinggi batang (mis. nilai negatif digambar 0). */
  nilaiTampil?: string;
};

export function DiagramKolom({
  kolom,
  format = rpRingkas,
  formatPenuh,
  maks: maksTetap,
  tinggi = 180,
  onPilih,
  labelKosong = "tidak ada data",
  ariaLabel,
}: {
  kolom: Kolom[];
  format?: (n: number) => string;
  formatPenuh?: (n: number) => string;
  /** Batas atas sumbu tetap (mis. 100 untuk persen). */
  maks?: number;
  tinggi?: number;
  onPilih?: (kunci: string) => void;
  labelKosong?: string;
  ariaLabel: string;
}) {
  const [sorot, setSorot] = useState<string | null>(null);
  const total = (k: Kolom) => (k.segmen ?? []).reduce((s, x) => s + x.nilai, 0);
  const maks = maksTetap ?? batasRapi(Math.max(0, ...kolom.map(total)));
  const iPuncak = kolom.reduce((bi, k, i, a) => (total(k) > total(a[bi]) ? i : bi), 0);
  const label = new Set(indeksLabel(kolom.length, 6));
  const penuh = formatPenuh ?? format;
  const iSorot = sorot ? kolom.findIndex((k) => k.kunci === sorot) : -1;
  const kS = iSorot >= 0 ? kolom[iSorot] : null;
  const bertumpuk = kolom.some((k) => (k.segmen?.length ?? 0) > 1);

  return (
    <div className="relative select-none" onPointerLeave={() => setSorot(null)}>
      <div className="flex">
        <div className="relative w-11 shrink-0 text-[9.5px] text-ink/40 tabular-nums" style={{ height: tinggi }} aria-hidden>
          {[1, 0.5, 0].map((f) => (
            <span key={f} className="absolute right-1.5 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(1 - f) * 100}%` }}>
              {format(maks * f)}
            </span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: tinggi }} aria-hidden>
            {[0, 0.5, 1].map((f) => (
              <div key={f} className={`absolute inset-x-0 h-px ${f === 1 ? "bg-ink/20" : "bg-ink/[0.07]"}`} style={{ top: `${f * 100}%` }} />
            ))}
          </div>
          <div className="relative flex items-end" style={{ height: tinggi }} role="list" aria-label={ariaLabel}>
            {kolom.map((k, i) => {
              const t = total(k);
              const h = k.segmen ? Math.min(100, (t / maks) * 100) : 0;
              const redup = sorot && sorot !== k.kunci;
              const seg = (k.segmen ?? []).filter((s) => s.nilai > 0);
              return (
                <button
                  key={k.kunci}
                  type="button"
                  role="listitem"
                  className="group/kol relative h-full flex-1 min-w-0 flex items-end justify-center px-[1px] focus-visible:outline-none"
                  onPointerEnter={() => setSorot(k.kunci)}
                  onFocus={() => setSorot(k.kunci)}
                  onClick={() => {
                    setSorot(k.kunci);
                    onPilih?.(k.kunci);
                  }}
                  aria-label={`${k.judul ?? k.label}: ${k.nilaiTampil ?? (k.segmen ? penuh(t) : labelKosong)}`}
                >
                  <span className={`absolute inset-y-0 inset-x-[1px] rounded-md transition-colors ${sorot === k.kunci ? "bg-ink/[0.05]" : ""} group-focus-visible/kol:ring-2 group-focus-visible/kol:ring-gold-500/50`} />
                  {k.segmen === null ? (
                    <span className="relative w-full max-w-[24px] h-[6px] rounded-[3px] border border-dashed border-ink/25" />
                  ) : (
                    <span
                      className="relative w-full max-w-[24px] flex flex-col-reverse gap-[2px] viz-tumbuh-y transition-[height,opacity] duration-500 ease-out"
                      style={{ height: `${h}%`, opacity: redup ? 0.4 : k.pudar ? 0.55 : 1, animationDelay: `${Math.min(0.6, 0.03 * i)}s` }}
                    >
                      {seg.map((s, j) => (
                        <span
                          key={s.nama}
                          className={`block w-full ${j === seg.length - 1 ? "rounded-t-[4px]" : ""}`}
                          style={{ flexGrow: s.nilai, flexBasis: 0, background: s.warna, minHeight: 1 }}
                        />
                      ))}
                      {i === iPuncak && t > 0 && (
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9.5px] font-semibold text-ink/70 whitespace-nowrap tabular-nums">{format(t)}</span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="relative h-5 mt-1 text-[9.5px] text-ink/45" aria-hidden>
            {kolom.map((k, i) =>
              label.has(i) ? (
                <span
                  key={k.kunci}
                  className="absolute top-0 whitespace-nowrap"
                  style={{
                    left: `${((i + 0.5) / kolom.length) * 100}%`,
                    transform: i === 0 && kolom.length > 6 ? "translateX(-20%)" : i === kolom.length - 1 && kolom.length > 6 ? "translateX(-80%)" : "translateX(-50%)",
                  }}
                >
                  {k.label}
                </span>
              ) : null,
            )}
          </div>
          {kS && (
            <div
              className="absolute z-10 top-1 pointer-events-none w-[172px] sm:w-[190px] rounded-xl bg-base-900/95 backdrop-blur border border-ink/10 shadow-[0_18px_40px_-20px_rgba(43,38,32,0.55)] p-2.5 anim-pop"
              style={{
                left: `${((iSorot + 0.5) / kolom.length) * 100}%`,
                transform: iSorot / kolom.length > 0.55 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
              }}
              role="status"
            >
              <div className="text-[10.5px] text-ink/55">{kS.judul ?? kS.label}</div>
              <div className="text-[14px] font-semibold text-ink tabular-nums">{kS.nilaiTampil ?? (kS.segmen ? penuh(total(kS)) : labelKosong)}</div>
              {bertumpuk && kS.segmen && (
                <div className="mt-1 space-y-0.5">
                  {kS.segmen
                    .filter((s) => s.nilai > 0)
                    .slice()
                    .reverse()
                    .map((s) => (
                      <div key={s.nama} className="flex items-center gap-1.5 text-[10.5px]">
                        <span className="w-2.5 h-[2px] rounded-full shrink-0" style={{ background: s.warna }} />
                        <span className="text-ink/60 truncate flex-1">{s.nama}</span>
                        <span className="font-medium text-ink tabular-nums">{format(s.nilai)}</span>
                      </div>
                    ))}
                </div>
              )}
              {kS.catatan && <div className="text-[9.5px] text-ink/45 mt-1">{kS.catatan}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Air terjun (dari pendapatan ke laba) ───────────────────────────────────

export type LangkahAir = {
  label: string;
  sub?: string;
  /** Rentang yang digambar [dari, ke] pada sumbu nilai. */
  dari: number;
  ke: number;
  /** "masuk" = pendapatan/subtotal, "keluar" = biaya, "hasil" = laba (hijau bila >= 0, merah bila rugi). */
  jenis: "masuk" | "keluar" | "hasil";
  /** Teks nilai di kanan, apa adanya dari pemanggil. */
  teks: string;
};

const WARNA_AIR = { masuk: "#4f6e55", keluar: "#c5614f", hasilPlus: "#3e5a44", hasilMinus: "#b0412f" };

export function AirTerjun({ langkah }: { langkah: LangkahAir[] }) {
  const semua = langkah.flatMap((l) => [l.dari, l.ke]);
  const lo = Math.min(0, ...semua);
  const hi = Math.max(0, ...semua);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="space-y-2.5">
      {langkah.map((l, i) => {
        const a = Math.min(l.dari, l.ke);
        const b = Math.max(l.dari, l.ke);
        const warna = l.jenis === "hasil" ? (l.ke - l.dari >= 0 ? WARNA_AIR.hasilPlus : WARNA_AIR.hasilMinus) : WARNA_AIR[l.jenis];
        return (
          <div key={l.label} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[180px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <div className="min-w-0">
              <div className={`text-[11.5px] truncate ${l.jenis === "keluar" ? "text-ink/65" : "text-ink font-semibold"}`}>{l.label}</div>
              {l.sub && <div className="text-[9.5px] text-ink/40 truncate">{l.sub}</div>}
            </div>
            <div className={`text-[12px] tabular-nums text-right whitespace-nowrap sm:order-3 ${l.jenis === "keluar" ? "text-ruby-500" : "font-semibold text-ink"}`}>{l.teks}</div>
            <div className="relative h-3.5 col-span-2 sm:col-span-1 sm:order-2 rounded-[3px] bg-ink/[0.03]">
              {lo < 0 && <span className="absolute inset-y-[-3px] w-px bg-ink/25" style={{ left: `${pos(0)}%` }} />}
              <span
                className="absolute inset-y-0 rounded-[4px] viz-tumbuh-x"
                style={{ left: `${pos(a)}%`, width: `${Math.max(0.6, pos(b) - pos(a))}%`, background: warna, animationDelay: `${0.12 * i}s` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Dua nilai berdampingan pada skala yang sama ────────────────────────────

export function DuaBatang({ a, b }: { a: { label: string; nilai: number; teks: string; warna: string }; b: { label: string; nilai: number; teks: string; warna: string } }) {
  const maks = Math.max(a.nilai, b.nilai, 1);
  return (
    <div className="space-y-2">
      {[a, b].map((x, i) => (
        <div key={x.label}>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-ink/60">{x.label}</span>
            <span className="font-semibold text-ink tabular-nums">{x.teks}</span>
          </div>
          <div className="mt-1 h-2.5 rounded-full bg-ink/[0.04]">
            <div className="h-full rounded-full viz-tumbuh-x" style={{ width: `${Math.max(0, (x.nilai / maks) * 100)}%`, background: x.warna, animationDelay: `${0.1 * i}s` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Daftar batang berperingkat ─────────────────────────────────────────────

export function DaftarBatang({ items, warna = WARNA_UTAMA }: { items: { label: string; nilai: number; teks: string; warna?: string; sub?: string }[]; warna?: string }) {
  const maks = Math.max(1, ...items.map((x) => x.nilai));
  const total = items.reduce((s, x) => s + Math.max(0, x.nilai), 0);
  return (
    <div className="space-y-3">
      {items.map((x, i) => (
        <div key={x.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              {x.warna && <Swatch warna={x.warna} />}
              <span className="text-ink/75 truncate">{x.label}</span>
            </span>
            <span className="font-semibold text-ink tabular-nums whitespace-nowrap">{x.teks}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-ink/[0.04]">
              <div
                className="h-full rounded-r-[4px] rounded-l-full viz-tumbuh-x"
                style={{ width: `${Math.max(0, (x.nilai / maks) * 100)}%`, background: x.warna ?? warna, animationDelay: `${0.06 * i}s` }}
              />
            </div>
            <span className="w-9 text-right text-[10px] text-ink/45 tabular-nums">{total > 0 ? `${Math.round((Math.max(0, x.nilai) / total) * 100)}%` : ""}</span>
          </div>
          {x.sub && <div className="text-[10px] text-ink/45 mt-0.5">{x.sub}</div>}
        </div>
      ))}
    </div>
  );
}
