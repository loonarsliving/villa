"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/Card";
import { Modal, Btn } from "@/components/Modal";
import { Meter } from "@/components/viz";
import { fmtCurrencyFull } from "@/lib/format";
import { rentangTanggal } from "@/lib/handover";
import { cocokCari, jumlahMalam, tautanWa, type Papan } from "@/lib/papanFrontDesk";
import type { Booking, Unit } from "@/lib/types";

/**
 * Papan kerja resepsionis (owner 2026-11-14): tamu yang datang & pulang hari
 * ini dengan tombol sekali-ketuk, dan peta unit yang bisa diketuk. Semua aksi
 * memanggil alur yang SAMA dengan sebelumnya (kartu check-in + POST /checkin,
 * modal check-out + POST /checkout) -- tidak ada jalur baru ke villa-api.
 */

const sumberLabel = (s: string) => (s === "cloudbeds" ? "☁ Cloudbeds" : s);

function TombolWa({ hp }: { hp: string | null | undefined }) {
  const url = tautanWa(hp);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`WhatsApp ${hp}`}
      aria-label={`WhatsApp tamu ${hp}`}
      className="shrink-0 w-8 h-8 grid place-items-center rounded-full border border-sage-500/30 text-sage-600 bg-sage-500/[0.08] hover:bg-sage-500/20 transition"
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
      </svg>
    </a>
  );
}

function UbinUnit({ nomor, nada }: { nomor: string; nada: "gold" | "ruby" | "sage" | "ink" }) {
  const kls =
    nada === "gold"
      ? "from-gold-500 to-gold-600 text-white"
      : nada === "ruby"
        ? "from-ruby-400 to-ruby-500 text-white"
        : nada === "sage"
          ? "from-sage-400 to-sage-600 text-white"
          : "from-ink/10 to-ink/5 text-ink/60";
  return (
    <div className={`shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${kls} grid place-items-center font-serif text-[17px] leading-none shadow-sm`}>{nomor}</div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Tamu datang & pulang hari ini
// ═════════════════════════════════════════════════════════════════════════

export function TamuHariIni({
  papan,
  cari,
  onCheckin,
  onCheckout,
  unitLabel,
}: {
  papan: Papan;
  cari: string;
  onCheckin: (bk: Booking) => void;
  onCheckout: (unitId: string) => void;
  unitLabel: string;
}) {
  const datang = papan.datang.filter((d) => cocokCari(d.bk, cari));
  const pulang = papan.pulang.filter((p) => cocokCari(p.bk, cari));
  const sudahDatang = papan.datang.filter((d) => d.selesai).length;
  const sudahPulang = papan.pulang.filter((p) => p.selesai).length;

  return (
    <div className="grid lg:grid-cols-2 gap-3.5 mb-3.5">
      <Card>
        <CardHeader title="Tamu Datang" subtitle={`${papan.datang.length - sudahDatang} belum check-in · ${sudahDatang} sudah`} />
        <div className="px-4 sm:px-5 pt-3">
          <Meter nilai={sudahDatang} maks={Math.max(1, papan.datang.length)} warna="#4f6e55" label="Tamu sudah check-in" />
        </div>
        <div className="p-2.5 sm:p-3 space-y-1.5">
          {papan.datang.length === 0 ? (
            <Kosong teks="Tidak ada tamu yang dijadwalkan datang hari ini." />
          ) : datang.length === 0 ? (
            <Kosong teks={`Tidak ada yang cocok dengan "${cari}".`} />
          ) : (
            datang.map(({ bk, selesai, terlambat }, i) => {
              const malam = jumlahMalam(bk.tgl_checkin, bk.tgl_checkout);
              return (
                <div
                  key={bk.id}
                  className={`anim-fade-up flex items-center gap-3 rounded-xl border p-2.5 transition ${
                    selesai ? "border-ink/[0.05] bg-base-800/30 opacity-70" : "border-ink/[0.08] bg-base-900 hover:border-gold-500/40 hover:shadow-md hover:shadow-ink/5"
                  }`}
                  style={{ animationDelay: `${0.04 * i}s` }}
                >
                  <UbinUnit nomor={bk.unit_nomor} nada={selesai ? "sage" : terlambat ? "ruby" : "gold"} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-ink truncate">{bk.guest_nama}</div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-[10px] text-ink/50">
                      {terlambat && <span className="font-semibold text-ruby-500">Terlambat · jadwal {rentangTanggal(bk.tgl_checkin, null)}</span>}
                      <span>
                        {unitLabel} {bk.unit_nomor}
                      </span>
                      {malam && <span>· {malam} malam</span>}
                      <span>· {sumberLabel(bk.sumber)}</span>
                      {bk.paket_dekorasi && <span className="text-gold-700 font-semibold">· 🎉 {bk.paket_dekorasi}</span>}
                    </div>
                  </div>
                  <TombolWa hp={bk.guest_hp} />
                  {selesai ? (
                    <span className="shrink-0 text-[10px] font-semibold text-sage-600 px-2">✓ Masuk</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onCheckin(bk)}
                      className="shrink-0 sheen text-[11px] font-semibold text-white bg-gold-500 hover:bg-gold-600 rounded-full px-3.5 py-2 shadow-sm shadow-gold-500/30 transition"
                    >
                      Check-In
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Tamu Pulang" subtitle={`${papan.pulang.length - sudahPulang} belum check-out · ${sudahPulang} sudah`} />
        <div className="px-4 sm:px-5 pt-3">
          <Meter nilai={sudahPulang} maks={Math.max(1, papan.pulang.length)} warna="#b4693f" label="Tamu sudah check-out" />
        </div>
        <div className="p-2.5 sm:p-3 space-y-1.5">
          {papan.pulang.length === 0 ? (
            <Kosong teks="Tidak ada check-out hari ini." />
          ) : pulang.length === 0 ? (
            <Kosong teks={`Tidak ada yang cocok dengan "${cari}".`} />
          ) : (
            pulang.map(({ bk, selesai }, i) => (
              <div
                key={bk.id}
                className={`anim-fade-up flex items-center gap-3 rounded-xl border p-2.5 transition ${
                  selesai ? "border-ink/[0.05] bg-base-800/30 opacity-70" : "border-ink/[0.08] bg-base-900 hover:border-gold-500/40 hover:shadow-md hover:shadow-ink/5"
                }`}
                style={{ animationDelay: `${0.04 * i}s` }}
              >
                <UbinUnit nomor={bk.unit_nomor} nada={selesai ? "ink" : "gold"} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold text-ink truncate">{bk.guest_nama}</div>
                  <div className="text-[10px] text-ink/50 mt-0.5">
                    {unitLabel} {bk.unit_nomor} · {rentangTanggal(bk.tgl_checkin, bk.tgl_checkout)} · {sumberLabel(bk.sumber)}
                  </div>
                </div>
                <TombolWa hp={bk.guest_hp} />
                {selesai ? (
                  <span className="shrink-0 text-[10px] font-semibold text-ink/45 px-2">✓ Keluar</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCheckout(bk.unit_id)}
                    className="shrink-0 text-[11px] font-semibold text-ink bg-base-800 border border-ink/15 hover:border-gold-500/50 hover:bg-gold-500/10 rounded-full px-3.5 py-2 transition"
                  >
                    Check-Out
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function Kosong({ teks }: { teks: string }) {
  return <div className="text-[11px] text-ink/45 text-center py-5">{teks}</div>;
}

// ═════════════════════════════════════════════════════════════════════════
// Peta unit interaktif
// ═════════════════════════════════════════════════════════════════════════

type Saring = "semua" | "available" | "occupied" | "datang" | "pulang" | "dirty" | "maintenance";

const GAYA_STATUS: Record<Unit["status"], { label: string; kls: string; titik: string }> = {
  available: { label: "Tersedia", kls: "bg-sage-500/[0.07] border-sage-500/30", titik: "bg-sage-500" },
  occupied: { label: "Terisi", kls: "bg-gold-500/[0.09] border-gold-500/35", titik: "bg-gold-500" },
  checkout: { label: "Checkout", kls: "bg-ruby-500/[0.07] border-ruby-500/35", titik: "bg-ruby-500" },
  dirty: { label: "Kotor", kls: "bg-base-800/40 border-dashed border-ink/25", titik: "bg-ink/40" },
  maintenance: { label: "Maintenance", kls: "bg-ruby-500/[0.1] border-ruby-500/40", titik: "bg-ruby-600" },
};

export function PetaUnit({
  units,
  papan,
  cari,
  unitLabel,
  onCheckin,
  onCheckout,
  onHousekeeping,
}: {
  units: Unit[];
  papan: Papan;
  cari: string;
  unitLabel: string;
  onCheckin: (bk: Booking) => void;
  onCheckout: (unitId: string) => void;
  onHousekeeping: () => void;
}) {
  const [saring, setSaring] = useState<Saring>("semua");
  const [dipilih, setDipilih] = useState<string | null>(null);

  const lolos = (u: Unit) => cocokSaring(u, saring, papan);
  const hitung = (s: Saring) => units.filter((u) => cocokSaring(u, s, papan)).length;

  const cocok = (u: Unit) => {
    if (!cari.trim()) return true;
    const orang = [papan.penghuni.get(u.id), papan.datangPerUnit.get(u.id), papan.pulangPerUnit.get(u.id)].filter(Boolean) as Booking[];
    return u.nomor.toLowerCase().includes(cari.trim().toLowerCase()) || orang.some((b) => cocokCari(b, cari));
  };

  const pilihan: { k: Saring; label: string }[] = [
    { k: "semua", label: "Semua" },
    { k: "available", label: "Tersedia" },
    { k: "occupied", label: "Terisi" },
    { k: "datang", label: "Datang hari ini" },
    { k: "pulang", label: "Pulang hari ini" },
    { k: "dirty", label: "Kotor" },
    { k: "maintenance", label: "Maintenance" },
  ];

  const u = dipilih ? units.find((x) => x.id === dipilih) ?? null : null;
  const penghuni = u ? papan.penghuni.get(u.id) : undefined;
  const akanDatang = u ? papan.datangPerUnit.get(u.id) : undefined;
  const akanPulang = u ? papan.pulangPerUnit.get(u.id) : undefined;

  return (
    <>
      <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 mb-2">
        {pilihan.map((p) => {
          const n = hitung(p.k);
          if (p.k !== "semua" && n === 0) return null;
          return (
            <button
              key={p.k}
              type="button"
              onClick={() => setSaring(p.k)}
              aria-pressed={saring === p.k}
              className={`shrink-0 inline-flex items-center gap-1.5 text-[10.5px] font-medium rounded-full px-2.5 py-1 border transition ${
                saring === p.k ? "bg-forest text-cream border-forest" : "border-ink/12 text-ink/60 hover:border-ink/25"
              }`}
            >
              {p.label}
              <span className={`tabular-nums text-[9.5px] ${saring === p.k ? "text-cream/70" : "text-ink/40"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-4 min-[420px]:grid-cols-5 sm:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2">
        {units.filter(lolos).map((x, i) => {
          const g = GAYA_STATUS[x.status];
          const p = papan.penghuni.get(x.id);
          const d = papan.datangPerUnit.get(x.id);
          const k = papan.pulangPerUnit.get(x.id);
          const redup = !cocok(x);
          const nama = (p ?? d)?.guest_nama.split(" ")[0];
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setDipilih(x.id)}
              className={`anim-pop relative rounded-xl border px-1.5 pt-2 pb-1.5 text-center transition duration-300 hover:-translate-y-0.5 hover:shadow-md hover:shadow-ink/10 ${g.kls} ${
                redup ? "opacity-25" : ""
              }`}
              style={{ animationDelay: `${Math.min(0.5, 0.015 * i)}s` }}
              aria-label={`${unitLabel} ${x.nomor}, ${g.label}${p ? `, tamu ${p.guest_nama}` : ""}${d ? `, akan datang ${d.guest_nama}` : ""}${k ? ", check-out hari ini" : ""}`}
            >
              {d && !p && <span className="absolute inset-0 rounded-xl ring-2 ring-azure-500/40 anim-ping pointer-events-none" aria-hidden />}
              <div className="flex items-center justify-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${g.titik}`} aria-hidden />
                <span className="font-serif text-[17px] leading-none text-ink">{x.nomor}</span>
              </div>
              <div className="text-[8.5px] text-ink/50 mt-1 truncate">{nama ?? g.label}</div>
              {(d || k) && (
                <div className="absolute -top-1.5 -right-1.5 flex gap-0.5" aria-hidden>
                  {k && <span className="w-4 h-4 grid place-items-center rounded-full bg-gold-500 text-white text-[8px] shadow">↑</span>}
                  {d && <span className="w-4 h-4 grid place-items-center rounded-full bg-azure-500 text-white text-[8px] shadow">↓</span>}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 text-[9.5px] text-ink/45">
        <span className="inline-flex items-center gap-1">
          <span className="w-3.5 h-3.5 grid place-items-center rounded-full bg-azure-500 text-white text-[7px]">↓</span> datang hari ini
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3.5 h-3.5 grid place-items-center rounded-full bg-gold-500 text-white text-[7px]">↑</span> pulang hari ini
        </span>
        <span>Ketuk {unitLabel.toLowerCase()} untuk detail &amp; aksi</span>
      </div>

      <Modal
        open={!!u}
        title={u ? `${unitLabel} ${u.nomor}` : ""}
        onClose={() => setDipilih(null)}
        footer={<Btn onClick={() => setDipilih(null)}>Tutup</Btn>}
      >
        {u && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${GAYA_STATUS[u.status].titik}`} />
              <span className="text-[12px] font-semibold text-ink">{GAYA_STATUS[u.status].label}</span>
              {u.catatan && <span className="text-[10.5px] text-ink/50 truncate">· {u.catatan}</span>}
            </div>

            {penghuni && (
              <Blok judul="Sedang menginap" bk={penghuni} unitLabel={unitLabel}>
                {akanPulang?.id === penghuni.id && (
                  <Btn
                    variant="primary"
                    onClick={() => {
                      setDipilih(null);
                      onCheckout(u.id);
                    }}
                  >
                    Check-Out sekarang
                  </Btn>
                )}
              </Blok>
            )}
            {akanDatang && (
              <Blok judul="Akan datang" bk={akanDatang} unitLabel={unitLabel}>
                <Btn
                  variant="primary"
                  onClick={() => {
                    setDipilih(null);
                    onCheckin(akanDatang);
                  }}
                >
                  Check-In sekarang
                </Btn>
              </Blok>
            )}
            {!penghuni && !akanDatang && <div className="text-[11.5px] text-ink/55">Tidak ada tamu yang menginap atau datang hari ini di {unitLabel.toLowerCase()} ini.</div>}
            {(u.status === "occupied" || u.status === "checkout") && !akanPulang && penghuni && (
              <Btn
                onClick={() => {
                  setDipilih(null);
                  onCheckout(u.id);
                }}
              >
                Check-Out lebih awal…
              </Btn>
            )}
            {u.status === "dirty" && (
              <Btn
                onClick={() => {
                  setDipilih(null);
                  onHousekeeping();
                }}
              >
                🧹 Buka Housekeeping
              </Btn>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function cocokSaring(u: Unit, s: Saring, papan: Papan): boolean {
  switch (s) {
    case "semua":
      return true;
    case "occupied":
      return u.status === "occupied" || u.status === "checkout";
    case "datang":
      return papan.datangPerUnit.has(u.id);
    case "pulang":
      return papan.pulangPerUnit.has(u.id);
    default:
      return u.status === s;
  }
}

function Blok({ judul, bk, unitLabel, children }: { judul: string; bk: Booking; unitLabel: string; children?: React.ReactNode }) {
  const malam = jumlahMalam(bk.tgl_checkin, bk.tgl_checkout);
  return (
    <div className="rounded-xl border border-ink/[0.08] bg-base-800/30 p-3">
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-ink/45">{judul}</div>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-ink truncate">{bk.guest_nama}</div>
          <div className="text-[10.5px] text-ink/55 mt-0.5">
            {rentangTanggal(bk.tgl_checkin, bk.tgl_checkout)}
            {malam ? ` · ${malam} malam` : ""} · {sumberLabel(bk.sumber)}
          </div>
          {bk.guest_hp && <div className="text-[10.5px] text-ink/55">{bk.guest_hp}</div>}
          {bk.paket_dekorasi && <div className="text-[10.5px] text-gold-700 font-semibold mt-0.5">🎉 Paket {bk.paket_dekorasi}</div>}
          <div className="text-[10.5px] text-ink/45 mt-0.5">
            {unitLabel} {bk.unit_nomor} · {fmtCurrencyFull(bk.total_bayar ?? bk.tarif)}
          </div>
        </div>
        <TombolWa hp={bk.guest_hp} />
      </div>
      {children && <div className="mt-2.5 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
