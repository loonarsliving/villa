"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { addDaysISO } from "@/lib/stayDates";
import { fmtDate, todayISO } from "@/lib/format";
import { AngkaRingkas, BarisRingkas, Meter, Saklar, Tombol } from "@/components/viz";
import { agendaPerHari, akhirPekan, posisiBatang, selisihHari, terisiPerHari } from "@/lib/kalenderBooking";
import { cocokCari } from "@/lib/papanFrontDesk";
import type { Booking, Unit } from "@/lib/types";

/**
 * Tampilan Kalender Booking (owner 2026-11-14: "desain lebih bagus dan
 * memudahkan"). Murni tampilan atas baris /units + /bookings yang sudah
 * dimuat halaman; klik booking tetap membuka DokumenCheckin seperti dulu.
 */

export type Tampilan = "kalender" | "daftar";
export type SaringStatus = "semua" | "checkin" | "terjadwal" | "checkout" | "menunggu_pembayaran";

const LABEL_STATUS: Record<string, string> = {
  terjadwal: "Terjadwal",
  checkin: "Menginap",
  checkout: "Sudah keluar",
  menunggu_pembayaran: "Menunggu bayar",
};

/** Gaya batang per status: menginap = hijau pekat, terjadwal = terakota, keluar = abu, menunggu bayar = garis putus. */
const GAYA_BATANG: Record<string, string> = {
  checkin: "bg-sage-500 text-white border-sage-600 shadow-sm shadow-sage-600/25",
  terjadwal: "bg-gold-500 text-white border-gold-600 shadow-sm shadow-gold-600/25",
  checkout: "bg-ink/[0.08] text-ink/55 border-ink/15",
  menunggu_pembayaran: "bg-base-900 text-ink/55 border-dashed border-ink/35",
};
const TITIK_STATUS: Record<string, string> = {
  checkin: "bg-sage-500",
  terjadwal: "bg-gold-500",
  checkout: "bg-ink/25",
  menunggu_pembayaran: "border border-dashed border-ink/40",
};

const RENTANG = [7, 14, 21, 30] as const;
const hariPendek = (d: string) => fmtDate(d, { weekday: "short" });
const tglAngka = (d: string) => Number(d.slice(8));
const sumberIkon = (s: string) => (s === "cloudbeds" ? "☁ " : "");
const nama = (s: string) => (s === "cloudbeds" ? "Cloudbeds (OTA)" : s);
function malam(b: Booking): number | null {
  return b.tgl_checkout ? selisihHari(b.tgl_checkin, b.tgl_checkout) : null;
}
function lolosSaring(b: Booking, s: SaringStatus) {
  return s === "semua" || b.status === s;
}

// ── Toolbar ────────────────────────────────────────────────────────────────

export function KalenderToolbar({
  start,
  rangeDays,
  onStart,
  onRange,
  tampilan,
  onTampilan,
  cari,
  onCari,
  saring,
  onSaring,
  bookings,
}: {
  start: string;
  rangeDays: number;
  onStart: (d: string) => void;
  onRange: (n: number) => void;
  tampilan: Tampilan;
  onTampilan: (t: Tampilan) => void;
  cari: string;
  onCari: (s: string) => void;
  saring: SaringStatus;
  onSaring: (s: SaringStatus) => void;
  bookings: Booking[];
}) {
  const hitung = (s: SaringStatus) => bookings.filter((b) => lolosSaring(b, s)).length;
  const pilihan: { k: SaringStatus; label: string }[] = [
    { k: "semua", label: "Semua" },
    { k: "checkin", label: "Menginap" },
    { k: "terjadwal", label: "Terjadwal" },
    { k: "checkout", label: "Sudah keluar" },
    { k: "menunggu_pembayaran", label: "Menunggu bayar" },
  ];
  const navBtn = "w-8 h-8 grid place-items-center rounded-full border border-ink/10 text-ink/60 hover:border-gold-500/50 hover:text-ink transition";
  return (
    <div className="px-4 sm:px-5 py-3 border-b border-ink/[0.05] space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onStart(addDaysISO(start, -rangeDays))} className={navBtn} aria-label="Rentang sebelumnya">
            ‹
          </button>
          <button
            type="button"
            onClick={() => onStart(todayISO())}
            className="h-8 px-3 rounded-full border border-ink/10 text-[11px] font-semibold text-ink/70 hover:border-gold-500/50 hover:text-ink transition"
          >
            Hari ini
          </button>
          <button type="button" onClick={() => onStart(addDaysISO(start, rangeDays))} className={navBtn} aria-label="Rentang berikutnya">
            ›
          </button>
        </div>
        <input
          type="date"
          value={start}
          onChange={(e) => e.target.value && onStart(e.target.value)}
          aria-label="Lompat ke tanggal"
          className="h-8 rounded-full border border-ink/10 bg-transparent px-3 text-[11px] text-ink/70"
        />
        <Saklar>
          {RENTANG.map((n) => (
            <Tombol key={n} aktif={rangeDays === n} onClick={() => onRange(n)}>
              {n} hari
            </Tombol>
          ))}
        </Saklar>
        <Saklar className="ml-auto">
          <Tombol aktif={tampilan === "kalender"} onClick={() => onTampilan("kalender")}>
            ▦ Kalender
          </Tombol>
          <Tombol aktif={tampilan === "daftar"} onClick={() => onTampilan("daftar")}>
            ☰ Daftar
          </Tombol>
        </Saklar>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <svg viewBox="0 0 20 20" className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/35 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            value={cari}
            onChange={(e) => onCari(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onCari("")}
            placeholder="Cari tamu, unit, atau no. HP…"
            aria-label="Cari booking"
            className="w-full h-8 rounded-full border border-ink/10 bg-base-900 pl-8 pr-3 text-[11.5px] text-ink placeholder:text-ink/35 outline-none focus:border-gold-500/60 transition"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
          {pilihan.map((p) => {
            const n = hitung(p.k);
            if (p.k !== "semua" && n === 0) return null;
            return (
              <button
                key={p.k}
                type="button"
                onClick={() => onSaring(p.k)}
                aria-pressed={saring === p.k}
                className={`shrink-0 inline-flex items-center gap-1.5 text-[10.5px] font-medium rounded-full px-2.5 py-1 border transition ${
                  saring === p.k ? "bg-forest text-cream border-forest" : "border-ink/12 text-ink/60 hover:border-ink/25"
                }`}
              >
                {p.k !== "semua" && <span className={`w-2 h-2 rounded-full ${TITIK_STATUS[p.k]}`} aria-hidden />}
                {p.label}
                <span className={`tabular-nums text-[9.5px] ${saring === p.k ? "text-cream/70" : "text-ink/40"}`}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Ringkasan rentang ──────────────────────────────────────────────────────

export function RingkasanRentang({ bookings, days, totalUnit }: { bookings: Booking[]; days: string[]; totalUnit: number }) {
  const terisi = terisiPerHari(bookings, days);
  const totalMalam = totalUnit * days.length;
  const malamTerisi = terisi.reduce((s, n) => s + n, 0);
  const pct = totalMalam > 0 ? Math.round((malamTerisi / totalMalam) * 100) : 0;
  const datang = bookings.filter((b) => b.status !== "menunggu_pembayaran" && days.includes(b.tgl_checkin)).length;
  const pulang = bookings.filter((b) => b.status !== "menunggu_pembayaran" && b.tgl_checkout && days.includes(b.tgl_checkout)).length;
  return (
    <div className="px-4 sm:px-5 py-3.5 border-b border-ink/[0.05]">
      <BarisRingkas>
        <AngkaRingkas label="Okupansi rentang ini" nilai={`${pct}%`} kecil={`${malamTerisi} dari ${totalMalam} malam-unit`} tone="sage" />
        <AngkaRingkas label="Malam kosong" nilai={String(Math.max(0, totalMalam - malamTerisi))} kecil="masih bisa dijual" tone="gold" />
        <AngkaRingkas label="Tamu datang" nilai={String(datang)} kecil={`dalam ${days.length} hari`} />
        <AngkaRingkas label="Tamu pulang" nilai={String(pulang)} kecil={`dalam ${days.length} hari`} />
      </BarisRingkas>
    </div>
  );
}

// ── Grid kalender ──────────────────────────────────────────────────────────

const LEBAR_HARI = 46;
const LEBAR_UNIT = 72;

type Tip = { b: Booking; x: number; y: number };

export function KalenderGrid({
  units,
  bloks,
  blokLabel,
  bookings,
  days,
  start,
  cari,
  saring,
  unitLabel,
  onBuka,
}: {
  units: Unit[];
  bloks: string[];
  blokLabel: (b: string) => string;
  bookings: Booking[];
  days: string[];
  start: string;
  cari: string;
  saring: SaringStatus;
  unitLabel: string;
  onBuka: (id: string) => void;
}) {
  const [hariSorot, setHariSorot] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const hariIni = todayISO();
  const n = days.length;
  const terisi = terisiPerHari(bookings, days);
  const totalUnit = units.length || 1;
  const adaCari = cari.trim().length > 0;
  const minLebar = LEBAR_UNIT + n * LEBAR_HARI;

  const latar = (d: string) => (d === hariIni ? "bg-gold-500/[0.08]" : hariSorot === d ? "bg-ink/[0.035]" : akhirPekan(d) ? "bg-canvas/70" : "");

  return (
    <div className="overflow-x-auto" onPointerLeave={() => setHariSorot(null)}>
      <div style={{ minWidth: minLebar }}>
        {/* Kepala tanggal */}
        <div className="flex sticky top-0 z-20 bg-base-900 border-b border-ink/[0.06]">
          <div className="shrink-0 sticky left-0 z-30 bg-base-900 px-3 py-2 text-[9.5px] uppercase tracking-[0.12em] text-ink/40 flex items-end" style={{ width: LEBAR_UNIT }}>
            {unitLabel}
          </div>
          <div className="flex-1 flex">
            {days.map((d, i) => {
              const kini = d === hariIni;
              return (
                <div
                  key={d}
                  onPointerEnter={() => setHariSorot(d)}
                  className={`flex-1 text-center pt-1.5 pb-1 border-l border-ink/[0.04] ${latar(d)}`}
                  style={{ minWidth: LEBAR_HARI }}
                >
                  <div className={`text-[9px] uppercase tracking-wide ${akhirPekan(d) ? "text-gold-600" : "text-ink/40"}`}>{hariPendek(d)}</div>
                  <div
                    className={`mx-auto mt-0.5 w-7 h-7 grid place-items-center rounded-full text-[13px] font-semibold tabular-nums ${
                      kini ? "bg-gold-500 text-white shadow shadow-gold-500/40" : "text-ink/80"
                    }`}
                  >
                    {tglAngka(d)}
                  </div>
                  <div className="text-[8.5px] text-ink/35 h-3">{i === 0 || tglAngka(d) === 1 ? fmtDate(d, { month: "short" }) : ""}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Baris okupansi per malam */}
        <div className="flex border-b border-ink/[0.06]">
          <div className="shrink-0 sticky left-0 z-10 bg-base-900 px-3 py-1.5 text-[9.5px] text-ink/45 leading-tight" style={{ width: LEBAR_UNIT }}>
            Terisi
            <br />
            <span className="text-ink/30">per malam</span>
          </div>
          <div className="flex-1 flex">
            {days.map((d, i) => {
              const r = terisi[i] / totalUnit;
              const penuh = terisi[i] >= totalUnit;
              return (
                <div
                  key={d}
                  onPointerEnter={() => setHariSorot(d)}
                  title={`${fmtDate(d, { weekday: "long", day: "numeric", month: "long" })}: ${terisi[i]} dari ${units.length} terisi`}
                  className={`flex-1 border-l border-ink/[0.04] px-1.5 py-1.5 flex flex-col items-center justify-end gap-0.5 ${latar(d)}`}
                  style={{ minWidth: LEBAR_HARI }}
                >
                  <div className="w-full h-6 flex items-end justify-center">
                    <div
                      className="w-3.5 rounded-t-[3px] viz-tumbuh-y"
                      style={{ height: `${Math.max(6, r * 100)}%`, background: penuh ? "#4f6e55" : `rgba(180,105,63,${0.25 + r * 0.65})`, animationDelay: `${0.02 * i}s` }}
                    />
                  </div>
                  <div className={`text-[9px] tabular-nums ${penuh ? "text-sage-600 font-semibold" : "text-ink/50"}`}>{penuh ? "Penuh" : `${terisi[i]}/${units.length}`}</div>
                </div>
              );
            })}
          </div>
        </div>

        {bloks.map((blok) => {
          const blokUnits = units.filter((u) => String(u.blok) === blok);
          if (blokUnits.length === 0) return null;
          return (
            <div key={blok}>
              <div className="flex bg-gold-500/[0.05] border-t border-ink/[0.05]">
                <div className="sticky left-0 px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-gold-600">{blokLabel(blok)}</div>
              </div>
              {blokUnits.map((u, ui) => {
                const milik = bookings.filter((b) => b.unit_id === u.id);
                return (
                  <div key={u.id} className="group/baris flex border-t border-ink/[0.04] hover:bg-ink/[0.015]">
                    <div
                      className="shrink-0 sticky left-0 z-10 bg-base-900 group-hover/baris:bg-base-800 px-3 flex items-center gap-1.5 transition-colors"
                      style={{ width: LEBAR_UNIT }}
                    >
                      <span className="font-serif text-[15px] text-ink leading-none">{u.nomor}</span>
                    </div>
                    <div className="relative flex-1" style={{ height: 44 }}>
                      <div className="absolute inset-0 flex">
                        {days.map((d) => (
                          <div key={d} onPointerEnter={() => setHariSorot(d)} className={`flex-1 border-l border-ink/[0.04] ${latar(d)}`} style={{ minWidth: LEBAR_HARI }} />
                        ))}
                      </div>
                      {milik.map((b, bi) => {
                        const pos = posisiBatang(b, start, n);
                        if (!pos) return null;
                        const sembunyi = !lolosSaring(b, saring);
                        const redup = adaCari && !cocokCari(b, cari);
                        const lebarPx = (pos.lebar / 100) * n * LEBAR_HARI;
                        const m = malam(b);
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => onBuka(b.id)}
                            onPointerEnter={(e) => e.pointerType === "mouse" && setTip({ b, x: e.clientX, y: e.clientY })}
                            onPointerMove={(e) => e.pointerType === "mouse" && setTip({ b, x: e.clientX, y: e.clientY })}
                            onPointerLeave={() => setTip(null)}
                            className={`absolute top-[7px] bottom-[7px] border text-left text-[10px] font-medium px-2 truncate viz-tumbuh-x transition-[opacity,filter] duration-300 hover:brightness-110 hover:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60 ${
                              GAYA_BATANG[b.status] ?? GAYA_BATANG.terjadwal
                            } ${pos.potongKiri ? "rounded-l-none border-l-0" : "rounded-l-full"} ${pos.potongKanan ? "rounded-r-none border-r-0" : "rounded-r-full"} ${
                              sembunyi ? "opacity-0 pointer-events-none" : redup ? "opacity-20" : ""
                            }`}
                            style={{ left: `calc(${pos.kiri}% + 1px)`, width: `calc(${pos.lebar}% - 2px)`, animationDelay: `${Math.min(0.5, 0.02 * ui + 0.03 * bi)}s` }}
                            aria-label={`${b.guest_nama}, ${unitLabel} ${b.unit_nomor}, ${fmtDate(b.tgl_checkin)} sampai ${b.tgl_checkout ? fmtDate(b.tgl_checkout) : "—"}, ${LABEL_STATUS[b.status] ?? b.status}`}
                          >
                            {sumberIkon(b.sumber)}
                            {b.paket_dekorasi ? "🎉 " : ""}
                            {b.guest_nama}
                            {m && lebarPx > 150 && <span className="opacity-70 font-normal"> · {m} mlm</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 sm:px-5 py-2.5 border-t border-ink/[0.05] text-[9.5px] text-ink/50">
        {(["checkin", "terjadwal", "checkout", "menunggu_pembayaran"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`w-4 h-2.5 rounded-full ${TITIK_STATUS[s]}`} /> {LABEL_STATUS[s]}
          </span>
        ))}
        <span>☁ OTA lewat Cloudbeds · 🎉 paket dekorasi</span>
        <span>Batang dimulai tengah hari check-in dan berakhir tengah hari check-out · ketuk batang untuk detail & dokumen</span>
      </div>

      {tip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[90] pointer-events-none w-[220px] rounded-xl bg-base-900/95 backdrop-blur border border-ink/10 shadow-[0_18px_40px_-18px_rgba(43,38,32,0.55)] p-3 anim-pop"
            style={{
              left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 236),
              top: tip.y + 16,
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${TITIK_STATUS[tip.b.status]}`} />
              <span className="text-[10px] text-ink/55">{LABEL_STATUS[tip.b.status] ?? tip.b.status}</span>
            </div>
            <div className="text-[13px] font-semibold text-ink mt-0.5">{tip.b.guest_nama}</div>
            <div className="text-[10.5px] text-ink/60 mt-0.5">
              {unitLabel} {tip.b.unit_nomor} · {fmtDate(tip.b.tgl_checkin)} – {tip.b.tgl_checkout ? fmtDate(tip.b.tgl_checkout) : "—"}
              {malam(tip.b) ? ` · ${malam(tip.b)} malam` : ""}
            </div>
            <div className="text-[10.5px] text-ink/50">{nama(tip.b.sumber)}</div>
            {tip.b.guest_hp && <div className="text-[10.5px] text-ink/50">{tip.b.guest_hp}</div>}
            {tip.b.paket_dekorasi && <div className="text-[10.5px] text-gold-700 font-semibold mt-0.5">🎉 Paket {tip.b.paket_dekorasi}</div>}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── Daftar per hari (nyaman di HP) ─────────────────────────────────────────

export function DaftarHarian({
  bookings,
  days,
  totalUnit,
  cari,
  saring,
  unitLabel,
  onBuka,
}: {
  bookings: Booking[];
  days: string[];
  totalUnit: number;
  cari: string;
  saring: SaringStatus;
  unitLabel: string;
  onBuka: (id: string) => void;
}) {
  const hariIni = todayISO();
  const agenda = agendaPerHari(bookings, days);
  const lolos = (b: Booking) => lolosSaring(b, saring) && cocokCari(b, cari);

  return (
    <div className="p-3 sm:p-4 space-y-2.5">
      {agenda.map((a, i) => {
        const datang = a.datang.filter(lolos);
        const pulang = a.pulang.filter(lolos);
        const kini = a.tanggal === hariIni;
        const sepi = datang.length === 0 && pulang.length === 0;
        return (
          <div
            key={a.tanggal}
            className={`anim-fade-up rounded-2xl border ${kini ? "border-gold-500/40 bg-gold-500/[0.04]" : "border-ink/[0.07] bg-base-900"} ${sepi ? "opacity-80" : ""}`}
            style={{ animationDelay: `${Math.min(0.4, 0.03 * i)}s` }}
          >
            <div className="flex items-center gap-3 px-3.5 pt-3 pb-2">
              <div className={`w-11 h-11 shrink-0 rounded-xl grid place-items-center leading-none ${kini ? "bg-gold-500 text-white" : akhirPekan(a.tanggal) ? "bg-gold-500/10 text-gold-700" : "bg-ink/[0.05] text-ink/70"}`}>
                <div className="text-center">
                  <div className="text-[8.5px] uppercase tracking-wide opacity-80">{hariPendek(a.tanggal)}</div>
                  <div className="text-[16px] font-semibold tabular-nums mt-0.5">{tglAngka(a.tanggal)}</div>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12.5px] font-semibold text-ink">{fmtDate(a.tanggal, { weekday: "long", day: "numeric", month: "long" })}</span>
                  {kini && <span className="text-[8.5px] font-semibold uppercase tracking-wide text-white bg-gold-500 rounded px-1.5 py-0.5">Hari ini</span>}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 max-w-[180px]">
                    <Meter nilai={a.terisi} maks={Math.max(1, totalUnit)} warna={a.terisi >= totalUnit ? "#4f6e55" : "#b4693f"} label="Unit terisi malam ini" />
                  </div>
                  <span className="text-[10px] text-ink/50 tabular-nums whitespace-nowrap">
                    {a.terisi >= totalUnit ? "Penuh" : `${a.terisi}/${totalUnit} terisi · ${totalUnit - a.terisi} kosong`}
                  </span>
                </div>
              </div>
            </div>
            {sepi ? (
              <div className="px-3.5 pb-3 text-[10.5px] text-ink/40">Tidak ada tamu datang atau pulang.</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-x-3 gap-y-2 px-3 pb-3">
                <Kelompok judul="Datang" warna="bg-azure-500" items={datang} unitLabel={unitLabel} onBuka={onBuka} />
                <Kelompok judul="Pulang" warna="bg-gold-500" items={pulang} unitLabel={unitLabel} onBuka={onBuka} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Kelompok({ judul, warna, items, unitLabel, onBuka }: { judul: string; warna: string; items: Booking[]; unitLabel: string; onBuka: (id: string) => void }) {
  if (items.length === 0) return <div className="hidden sm:block" />;
  return (
    <div>
      <div className="flex items-center gap-1.5 px-1 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full ${warna}`} />
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink/50">
          {judul} · {items.length}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((b) => {
          const m = malam(b);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onBuka(b.id)}
              className="w-full text-left flex items-center gap-2.5 rounded-xl border border-ink/[0.06] bg-base-900 hover:border-gold-500/40 hover:shadow-sm px-2.5 py-2 transition"
            >
              <span className="font-serif text-[15px] text-ink w-8 shrink-0 text-center">{b.unit_nomor}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[11.5px] font-semibold text-ink truncate">
                  {b.paket_dekorasi ? "🎉 " : ""}
                  {b.guest_nama}
                </span>
                <span className="block text-[9.5px] text-ink/50 truncate">
                  {unitLabel} {b.unit_nomor}
                  {m ? ` · ${m} malam` : ""} · {nama(b.sumber)}
                </span>
              </span>
              <span className={`shrink-0 w-2 h-2 rounded-full ${TITIK_STATUS[b.status]}`} title={LABEL_STATUS[b.status] ?? b.status} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
