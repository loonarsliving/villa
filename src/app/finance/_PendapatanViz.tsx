"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/Card";
import { AnimatedValue } from "@/components/AnimatedValue";
import { fmtCurrencyFull, fmtDate } from "@/lib/format";
import type { FinanceChannelBreakdown, FinanceDateRow } from "@/lib/types";
import { batasRapi, indeksLabel, persen, rpRingkas, SLOT_CHANNEL, slotChannel, urutSlot, WARNA_LAINNYA, warnaChannel } from "@/lib/vizPendapatan";

/**
 * Tampilan diagram untuk "Revenue by Channel" dan "Pemasukan per Tanggal
 * Check-in" (owner 2026-11-14: tabel melebar & terpotong di HP, minta
 * tampilan lebih oke + diagram). MURNI TAMPILAN: setiap angka berasal apa
 * adanya dari respons villa-api; yang dijumlahkan di sini hanya penjumlahan
 * baris untuk label/total, sama seperti footer tabel lama. Tabel lama tetap
 * tersedia lewat tombol "Tabel" (versi aksesibel & untuk dicocokkan).
 */

type Metrik = "gross" | "net";

const LAINNYA = "Lainnya";

function Tombol({ aktif, onClick, children, label }: { aktif: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aktif}
      aria-label={label}
      className={`px-2.5 py-1 rounded-full text-[10.5px] font-medium transition-colors ${
        aktif ? "bg-forest text-cream shadow-sm" : "text-ink/55 hover:text-ink hover:bg-ink/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}

function Saklar({ children }: { children: React.ReactNode }) {
  return <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full border border-ink/10 bg-canvas/70">{children}</div>;
}

function Swatch({ warna, className = "" }: { warna: string; className?: string }) {
  return <span aria-hidden className={`inline-block w-2.5 h-2.5 rounded-[3px] shrink-0 ${className}`} style={{ background: warna }} />;
}

function Angka({ label, nilai, kecil, tone }: { label: string; nilai: string; kecil?: string; tone?: "ruby" | "sage" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink/45 truncate">{label}</div>
      <div className={`mt-0.5 text-[15px] sm:text-[17px] font-semibold leading-tight ${tone === "ruby" ? "text-ruby-500" : tone === "sage" ? "text-sage-600" : "text-ink"}`}>
        <AnimatedValue value={nilai} durasi={900} />
      </div>
      {kecil && <div className="text-[10px] text-ink/45 mt-0.5 truncate">{kecil}</div>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Revenue by Channel
// ═════════════════════════════════════════════════════════════════════════

export function RevenueByChannel({ data, range }: { data: FinanceChannelBreakdown; range: { from: string; to: string } }) {
  const [tabel, setTabel] = useState(false);
  const [aktif, setAktif] = useState<string | null>(null);

  const baris = useMemo(() => [...data.channels].sort((a, b) => b.revenue - a.revenue), [data.channels]);
  const segmen = useMemo(() => urutSlot(data.channels.filter((c) => c.revenue > 0), (c) => c.sumber), [data.channels]);
  const totalKotor = data.totals.revenue;
  const totalPotongan = data.channels.reduce((s, c) => s + c.ota_deduction, 0);
  const totalMalam = data.channels.reduce((s, c) => s + c.room_nights, 0);
  const totalBooking = data.channels.reduce((s, c) => s + c.booking_count, 0);
  const maksKotor = Math.max(1, ...data.channels.map((c) => c.revenue));

  return (
    <Card className="mb-4">
      <CardHeader
        title="Revenue by Channel"
        subtitle={`${range.from} s/d ${range.to}`}
        action={
          data.channels.length > 0 && (
            <Saklar>
              <Tombol aktif={!tabel} onClick={() => setTabel(false)}>Diagram</Tombol>
              <Tombol aktif={tabel} onClick={() => setTabel(true)}>Tabel</Tombol>
            </Saklar>
          )
        }
      />

      {data.channels.length === 0 ? (
        <div className="px-4 py-8 text-center text-[11px] text-ink/50">Tidak ada data pada periode ini.</div>
      ) : tabel ? (
        <TabelChannel data={data} />
      ) : (
        <div className="p-4 sm:p-5 space-y-5">
          {/* Ringkasan */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <Angka label="Kotor" nilai={fmtCurrencyFull(totalKotor)} kecil={`${totalBooking} booking · ${totalMalam} malam`} />
            <Angka label="Potongan OTA" nilai={totalPotongan > 0 ? `−${fmtCurrencyFull(totalPotongan)}` : "Rp 0"} tone="ruby" kecil={`${persen(totalPotongan, totalKotor)} dari kotor`} />
            <Angka label="Bersih" nilai={fmtCurrencyFull(data.totals.net_revenue)} tone="sage" />
            <Angka label="Outstanding" nilai={fmtCurrencyFull(data.totals.outstanding)} kecil={`OTA receivable ${fmtCurrencyFull(data.totals.ota_receivable)}`} />
          </div>

          {/* Porsi kotor per channel: batang bersegmen tinggi */}
          {totalKotor > 0 && segmen.length > 0 && (
            <div>
              <div className="text-[10.5px] text-ink/50 mb-1.5">Porsi pendapatan kotor</div>
              <div
                className="flex h-7 w-full gap-[2px] viz-tumbuh-x"
                role="img"
                aria-label={`Porsi kotor: ${segmen.map((c) => `${c.sumber} ${persen(c.revenue, totalKotor)}`).join(", ")}`}
              >
                {segmen.map((c) => {
                  const lebar = (c.revenue / totalKotor) * 100;
                  const redup = aktif && aktif !== c.sumber;
                  return (
                    <div
                      key={c.sumber}
                      className="relative h-full rounded-[4px] flex items-center overflow-visible transition-[opacity,filter] duration-300 cursor-default"
                      style={{ width: `${lebar}%`, background: warnaChannel(c.sumber), opacity: redup ? 0.35 : 1 }}
                      onPointerEnter={() => setAktif(c.sumber)}
                      onPointerLeave={() => setAktif(null)}
                      title={`${c.sumber}: ${fmtCurrencyFull(c.revenue)} (${persen(c.revenue, totalKotor)})`}
                    >
                      {lebar >= 13 && (
                        <span className={`pl-2 text-[10.5px] font-semibold tabular-nums ${slotChannel(c.sumber) === 2 ? "text-ink" : "text-white"}`}>
                          {persen(c.revenue, totalKotor)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2">
                {segmen.map((c) => (
                  <span key={c.sumber} className="inline-flex items-center gap-1.5 text-[10.5px] text-ink/65">
                    <Swatch warna={warnaChannel(c.sumber)} />
                    {c.sumber}
                    {(c.revenue / totalKotor) * 100 < 13 && <span className="text-ink/45 tabular-nums">{persen(c.revenue, totalKotor)}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Kartu per channel */}
          <div>
            <div className="flex items-center gap-3 text-[10px] text-ink/50 mb-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3.5 h-2 rounded-[2px] bg-ink/60" /> bersih
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3.5 h-2 rounded-[2px] bg-ink/20" /> potongan OTA
              </span>
              <span className="text-ink/40">· panjang batang = kotor</span>
            </div>
            <div className="grid lg:grid-cols-2 gap-2.5 stagger">
              {baris.map((c, i) => {
                const warna = warnaChannel(c.sumber);
                const lebarKotor = (c.revenue / maksKotor) * 100;
                const porsiBersih = c.revenue > 0 ? Math.max(0, Math.min(1, c.net_revenue / c.revenue)) : 0;
                const redup = aktif && aktif !== c.sumber;
                return (
                  <div
                    key={c.sumber}
                    onPointerEnter={() => setAktif(c.sumber)}
                    onPointerLeave={() => setAktif(null)}
                    className={`anim-fade-up rounded-xl border border-ink/[0.07] bg-canvas/40 hover:bg-canvas/80 hover:border-ink/[0.14] p-3 transition-[opacity,background-color,border-color] duration-300 ${redup ? "opacity-60" : ""}`}
                    style={{ animationDelay: `${0.05 * i}s` }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Swatch warna={warna} />
                          <span className="text-[12.5px] font-semibold text-ink truncate">{c.sumber}</span>
                        </div>
                        <div className="text-[10px] text-ink/45 mt-0.5 truncate">
                          {c.normalized_channel} · {c.booking_count} booking · {c.room_nights} malam
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13.5px] font-semibold text-ink leading-tight">
                          <AnimatedValue value={fmtCurrencyFull(c.net_revenue)} durasi={900} />
                        </div>
                        <div className="text-[9.5px] uppercase tracking-[0.12em] text-ink/40">bersih</div>
                      </div>
                    </div>

                    <div className="mt-2.5 h-2.5 rounded-full bg-ink/[0.05]" aria-hidden>
                      <div className="h-full flex gap-[2px] viz-tumbuh-x" style={{ width: `${lebarKotor}%`, animationDelay: `${0.12 + 0.06 * i}s` }}>
                        {porsiBersih > 0 && (
                          <div className="h-full rounded-l-full" style={{ width: `${porsiBersih * 100}%`, background: warna, borderRadius: porsiBersih >= 1 ? 9999 : undefined }} />
                        )}
                        {porsiBersih < 1 && <div className="h-full flex-1 rounded-r-full" style={{ background: warna, opacity: 0.32 }} />}
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[10.5px] text-ink/55 tabular-nums">
                      <span>Kotor {fmtCurrencyFull(c.revenue)}</span>
                      <span className="text-ruby-500">{c.ota_deduction > 0 ? `−${fmtCurrencyFull(c.ota_deduction)}` : "tanpa potongan"}</span>
                      <span className="text-ink/40">{persen(c.revenue, totalKotor)} dari total</span>
                    </div>

                    <dl className="mt-2.5 pt-2.5 border-t border-ink/[0.06] grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-[10.5px]">
                      <Info k="Avg Net ADR" v={c.avg_net_adr != null ? fmtCurrencyFull(c.avg_net_adr) : "—"} />
                      <Info k="Outstanding" v={fmtCurrencyFull(c.outstanding)} />
                      <Info k="Settlement" v={`${c.settled_count}/${c.settled_count + c.unsettled_count} diterima`} />
                      <Info k="Bank tujuan" v={c.destination_account ?? "—"} />
                    </dl>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink/40">{k}</dt>
      <dd className="text-ink/80 font-medium truncate tabular-nums" title={v}>
        {v}
      </dd>
    </div>
  );
}

function TabelChannel({ data: channels }: { data: FinanceChannelBreakdown }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr className="text-left text-ink/40 border-b border-ink/10">
            <th className="px-4 py-2">Channel</th>
            <th className="px-3 py-2">Room Nights</th>
            <th className="px-3 py-2">Gross Revenue</th>
            <th className="px-3 py-2">OTA Deduction</th>
            <th className="px-3 py-2">Net Revenue</th>
            <th className="px-3 py-2">Avg Net ADR</th>
            <th className="px-3 py-2">Outstanding</th>
            <th className="px-3 py-2">Settlement</th>
            <th className="px-3 py-2">Bank Tujuan</th>
          </tr>
        </thead>
        <tbody>
          {channels.channels.map((c) => (
            <tr key={c.sumber} className="border-b border-ink/5">
              <td className="px-4 py-2.5 whitespace-nowrap">
                <div className="font-medium text-ink/80">{c.sumber}</div>
                <div className="text-ink/50">
                  {c.normalized_channel} · {c.booking_count} booking
                </div>
              </td>
              <td className="px-3 py-2.5">{c.room_nights}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">{fmtCurrencyFull(c.revenue)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-ruby-500">{c.ota_deduction > 0 ? `−${fmtCurrencyFull(c.ota_deduction)}` : "—"}</td>
              <td className="px-3 py-2.5 whitespace-nowrap font-medium">{fmtCurrencyFull(c.net_revenue)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">{c.avg_net_adr != null ? fmtCurrencyFull(c.avg_net_adr) : "—"}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">{fmtCurrencyFull(c.outstanding)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                {c.settled_count}/{c.settled_count + c.unsettled_count} diterima
              </td>
              <td className="px-3 py-2.5 text-ink/50">{c.destination_account ?? "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-ink/10 font-semibold text-ink/70">
            <td className="px-4 py-2.5">Total</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 whitespace-nowrap">{fmtCurrencyFull(channels.totals.revenue)}</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 whitespace-nowrap">{fmtCurrencyFull(channels.totals.net_revenue)}</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 whitespace-nowrap">{fmtCurrencyFull(channels.totals.outstanding)}</td>
            <td className="px-3 py-2.5 whitespace-nowrap" colSpan={2}>
              OTA Receivable: {fmtCurrencyFull(channels.totals.ota_receivable)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Pemasukan per Tanggal Check-in
// ═════════════════════════════════════════════════════════════════════════

type Tumpuk = { sumber: string; warna: string; nilai: number };

/** Nilai per channel untuk satu tanggal, urut slot; channel di luar 5 utama digabung "Lainnya". */
function tumpukan(d: FinanceDateRow, m: Metrik): Tumpuk[] {
  const utama: Tumpuk[] = [];
  let lain = 0;
  for (const c of urutSlot(d.channels, (x) => x.sumber)) {
    const v = m === "gross" ? c.gross : c.net;
    if (slotChannel(c.sumber) < 0) lain += v;
    else utama.push({ sumber: c.sumber, warna: warnaChannel(c.sumber), nilai: v });
  }
  if (lain > 0) utama.push({ sumber: LAINNYA, warna: WARNA_LAINNYA, nilai: lain });
  return utama.filter((t) => t.nilai > 0);
}

const labelHari = (iso: string) => fmtDate(iso, { weekday: "short", day: "numeric", month: "short" });
const labelSumbu = (iso: string) => fmtDate(iso, { day: "numeric", month: "short" });

export function PemasukanPerTanggal({ data: channels }: { data: FinanceChannelBreakdown }) {
  const [metrik, setMetrik] = useState<Metrik>("gross");
  const [tabel, setTabel] = useState(false);
  const [sorot, setSorot] = useState<string | null>(null);
  const [buka, setBuka] = useState<Set<string>>(() => new Set());

  const hari = channels.by_date;
  const nilai = (d: FinanceDateRow) => (metrik === "gross" ? d.gross : d.net);
  const maks = batasRapi(Math.max(0, ...hari.map(nilai)));
  const iPuncak = hari.reduce((bi, d, i, a) => (nilai(d) > nilai(a[bi]) ? i : bi), 0);
  const label = new Set(indeksLabel(hari.length, 6));

  const tot = {
    booking: hari.reduce((s, d) => s + d.booking_count, 0),
    malam: hari.reduce((s, d) => s + d.malam, 0),
    gross: hari.reduce((s, d) => s + d.gross, 0),
    ota: hari.reduce((s, d) => s + d.ota_deduction, 0),
    net: hari.reduce((s, d) => s + d.net, 0),
  };

  const legenda = useMemo(() => {
    const ada = new Set<string>();
    let lain = false;
    for (const d of hari)
      for (const c of d.channels) {
        const i = slotChannel(c.sumber);
        if (i < 0) lain = true;
        else ada.add(SLOT_CHANNEL[i].kunci);
      }
    const out = SLOT_CHANNEL.filter((s) => ada.has(s.kunci)).map((s) => {
      // Nama yang tampil = nama sumber asli pertama yang cocok (mis. "booking.com").
      const nama = hari.flatMap((d) => d.channels).find((c) => slotChannel(c.sumber) === SLOT_CHANNEL.indexOf(s))?.sumber ?? s.kunci;
      return { nama, warna: s.warna as string };
    });
    if (lain) out.push({ nama: LAINNYA, warna: WARNA_LAINNYA });
    return out;
  }, [hari]);

  const dSorot = sorot ? hari.find((d) => d.tgl_checkin === sorot) ?? null : null;
  const iSorot = dSorot ? hari.indexOf(dSorot) : -1;

  function toggle(tgl: string) {
    setBuka((s) => {
      const n = new Set(s);
      if (n.has(tgl)) n.delete(tgl);
      else n.add(tgl);
      return n;
    });
  }
  function pilihKolom(tgl: string) {
    setSorot(tgl);
    setBuka((s) => new Set(s).add(tgl));
    window.setTimeout(() => {
      document.getElementById(`tgl-${tgl}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title="Pemasukan per Tanggal Check-in"
        subtitle="Per channel, kotor vs bersih setelah potongan komisi OTA"
      />
      {hari.length > 0 && (
        <div className="px-4 sm:px-5 pt-3 -mb-1 flex justify-end">
          <Saklar>
            <Tombol aktif={!tabel} onClick={() => setTabel(false)}>Diagram</Tombol>
            <Tombol aktif={tabel} onClick={() => setTabel(true)}>Tabel</Tombol>
          </Saklar>
        </div>
      )}

      {hari.length === 0 ? (
        <div className="px-4 py-8 text-center text-[11px] text-ink/50">Tidak ada data pada periode ini.</div>
      ) : tabel ? (
        <TabelTanggal data={channels} />
      ) : (
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mb-4">
            <Angka label="Booking" nilai={String(tot.booking)} kecil={`${tot.malam} malam · ${hari.length} hari check-in`} />
            <Angka label="Kotor" nilai={fmtCurrencyFull(tot.gross)} />
            <Angka label="Potongan OTA" nilai={tot.ota > 0 ? `−${fmtCurrencyFull(tot.ota)}` : "Rp 0"} tone="ruby" />
            <Angka label="Bersih" nilai={fmtCurrencyFull(tot.net)} tone="sage" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <Saklar>
              <Tombol aktif={metrik === "gross"} onClick={() => setMetrik("gross")}>Kotor</Tombol>
              <Tombol aktif={metrik === "net"} onClick={() => setMetrik("net")}>Bersih</Tombol>
            </Saklar>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {legenda.map((l) => (
                <span key={l.nama} className="inline-flex items-center gap-1.5 text-[10.5px] text-ink/65">
                  <Swatch warna={l.warna} />
                  {l.nama}
                </span>
              ))}
            </div>
          </div>

          {/* Diagram kolom bertumpuk per tanggal */}
          <div className="relative select-none" onPointerLeave={() => setSorot((s) => (s && buka.has(s) ? s : null))}>
            <div className="flex">
              {/* Sumbu Y */}
              <div className="relative w-11 shrink-0 h-[180px] text-[9.5px] text-ink/40 tabular-nums" aria-hidden>
                {[1, 0.5, 0].map((f) => (
                  <span key={f} className="absolute right-1.5 -translate-y-1/2" style={{ top: `${(1 - f) * 100}%` }}>
                    {rpRingkas(maks * f)}
                  </span>
                ))}
              </div>
              <div className="relative flex-1 min-w-0">
                {/* Garis kisi */}
                <div className="absolute inset-x-0 top-0 h-[180px] pointer-events-none" aria-hidden>
                  {[0, 0.5, 1].map((f) => (
                    <div key={f} className={`absolute inset-x-0 h-px ${f === 1 ? "bg-ink/20" : "bg-ink/[0.07]"}`} style={{ top: `${f * 100}%` }} />
                  ))}
                </div>
                <div className="relative flex h-[180px] items-end" role="list" aria-label={`Pemasukan ${metrik === "gross" ? "kotor" : "bersih"} per tanggal check-in`}>
                  {hari.map((d, i) => {
                    const t = tumpukan(d, metrik);
                    const tinggi = (nilai(d) / maks) * 100;
                    const redup = sorot && sorot !== d.tgl_checkin;
                    return (
                      <button
                        key={d.tgl_checkin}
                        type="button"
                        role="listitem"
                        className="group/kol relative h-full flex-1 min-w-0 flex items-end justify-center px-[1px] focus-visible:outline-none"
                        onPointerEnter={() => setSorot(d.tgl_checkin)}
                        onFocus={() => setSorot(d.tgl_checkin)}
                        onClick={() => pilihKolom(d.tgl_checkin)}
                        aria-label={`${labelHari(d.tgl_checkin)}: ${metrik === "gross" ? "kotor" : "bersih"} ${fmtCurrencyFull(nilai(d))}, ${d.booking_count} booking`}
                      >
                        <span className={`absolute inset-y-0 inset-x-[1px] rounded-md transition-colors ${sorot === d.tgl_checkin ? "bg-ink/[0.05]" : ""} group-focus-visible/kol:ring-2 group-focus-visible/kol:ring-gold-500/50`} />
                        <span
                          className="relative w-full max-w-[24px] flex flex-col-reverse gap-[2px] viz-tumbuh-y transition-[height,opacity] duration-500 ease-out"
                          style={{ height: `${tinggi}%`, opacity: redup ? 0.4 : 1, animationDelay: `${Math.min(0.6, 0.025 * i)}s` }}
                        >
                          {t.map((s, j) => (
                            <span
                              key={s.sumber}
                              className={`block w-full transition-[flex-grow] duration-500 ${j === t.length - 1 ? "rounded-t-[4px]" : ""}`}
                              style={{ flexGrow: s.nilai, flexBasis: 0, background: s.warna, minHeight: 1 }}
                            />
                          ))}
                          {i === iPuncak && nilai(d) > 0 && (
                            <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9.5px] font-semibold text-ink/70 whitespace-nowrap tabular-nums">
                              {rpRingkas(nilai(d))}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* Sumbu X */}
                <div className="relative h-5 mt-1 text-[9.5px] text-ink/45" aria-hidden>
                  {hari.map((d, i) =>
                    label.has(i) ? (
                      <span
                        key={d.tgl_checkin}
                        className="absolute top-0 whitespace-nowrap"
                        style={{
                          left: `${((i + 0.5) / hari.length) * 100}%`,
                          transform: i === 0 && hari.length > 6 ? "translateX(-20%)" : i === hari.length - 1 && hari.length > 6 ? "translateX(-80%)" : "translateX(-50%)",
                        }}
                      >
                        {labelSumbu(d.tgl_checkin)}
                      </span>
                    ) : null,
                  )}
                </div>

                {/* Tooltip */}
                {dSorot && (
                  <div
                    className="absolute z-10 top-1 pointer-events-none w-[172px] sm:w-[190px] rounded-xl bg-base-900/95 backdrop-blur border border-ink/10 shadow-[0_18px_40px_-20px_rgba(43,38,32,0.55)] p-2.5 anim-pop"
                    style={{
                      left: `${((iSorot + 0.5) / hari.length) * 100}%`,
                      transform: iSorot / hari.length > 0.55 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
                    }}
                    role="status"
                  >
                    <div className="text-[10.5px] text-ink/55">{labelHari(dSorot.tgl_checkin)}</div>
                    <div className="text-[14px] font-semibold text-ink tabular-nums">{fmtCurrencyFull(nilai(dSorot))}</div>
                    <div className="text-[9.5px] text-ink/45 mb-1.5">
                      {metrik === "gross" ? "kotor" : "bersih"} · {dSorot.booking_count} booking · {dSorot.malam} malam
                    </div>
                    <div className="space-y-0.5">
                      {tumpukan(dSorot, metrik)
                        .slice()
                        .reverse()
                        .map((s) => (
                          <div key={s.sumber} className="flex items-center gap-1.5 text-[10.5px]">
                            <span className="w-2.5 h-[2px] rounded-full shrink-0" style={{ background: s.warna }} />
                            <span className="text-ink/60 truncate flex-1">{s.sumber}</span>
                            <span className="font-medium text-ink tabular-nums">{rpRingkas(s.nilai)}</span>
                          </div>
                        ))}
                    </div>
                    {metrik === "gross" && dSorot.ota_deduction > 0 && (
                      <div className="mt-1.5 pt-1.5 border-t border-ink/[0.08] text-[10px] text-ruby-500 tabular-nums">
                        Potongan OTA −{fmtCurrencyFull(dSorot.ota_deduction)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="text-[10px] text-ink/40 mt-1">Ketuk batang untuk membuka rincian tanggalnya di bawah.</div>
          </div>

          {/* Daftar per tanggal (bisa dibuka-tutup) */}
          <div className="mt-4 rounded-xl border border-ink/[0.07] divide-y divide-ink/[0.06] overflow-hidden">
            {hari.map((d) => {
              const terbuka = buka.has(d.tgl_checkin);
              const t = tumpukan(d, metrik);
              const sum = t.reduce((s, x) => s + x.nilai, 0);
              return (
                <div key={d.tgl_checkin} id={`tgl-${d.tgl_checkin}`} className={`transition-colors ${sorot === d.tgl_checkin ? "bg-gold-500/[0.06]" : ""}`}>
                  <button
                    type="button"
                    onClick={() => toggle(d.tgl_checkin)}
                    onPointerEnter={() => setSorot(d.tgl_checkin)}
                    aria-expanded={terbuka}
                    className="w-full text-left px-3 sm:px-4 py-2.5 flex items-center gap-3 hover:bg-ink/[0.025]"
                  >
                    <div className="w-[72px] sm:w-[84px] shrink-0">
                      <div className="text-[11.5px] sm:text-[12px] font-semibold text-ink leading-tight whitespace-nowrap">{labelHari(d.tgl_checkin)}</div>
                      <div className="text-[10px] text-ink/45">
                        {d.booking_count} bkg · {d.malam} mlm
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex h-1.5 gap-[2px] rounded-full overflow-hidden bg-ink/[0.04]" aria-hidden>
                        {t.map((s) => (
                          <span key={s.sumber} className="h-full" style={{ width: `${sum > 0 ? (s.nilai / sum) * 100 : 0}%`, background: s.warna }} />
                        ))}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-1.5 text-[10px] text-ink/50 tabular-nums leading-snug">
                        <span className="whitespace-nowrap">Kotor {rpRingkas(d.gross)}</span>
                        {d.ota_deduction > 0 && <span className="whitespace-nowrap text-ruby-500">−{rpRingkas(d.ota_deduction)}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[12.5px] font-semibold text-ink tabular-nums">{fmtCurrencyFull(d.net)}</div>
                      <div className="text-[9.5px] uppercase tracking-[0.12em] text-ink/40">bersih</div>
                    </div>
                    <svg
                      viewBox="0 0 20 20"
                      className={`w-4 h-4 text-ink/35 shrink-0 transition-transform duration-300 ${terbuka ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden
                    >
                      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className={`viz-lipat ${terbuka ? "viz-lipat-buka" : ""}`}>
                    <div className="overflow-hidden">
                      <div className="px-3 sm:px-4 pb-3 space-y-2">
                        {urutSlot(d.channels, (c) => c.sumber).map((c) => (
                          <div key={c.sumber} className="rounded-lg bg-canvas/60 border border-ink/[0.05] p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 min-w-0">
                                <Swatch warna={warnaChannel(c.sumber)} />
                                <span className="text-[11.5px] font-medium text-ink truncate">{c.sumber}</span>
                                <span className="text-[10px] text-ink/45 shrink-0">komisi {c.commission_pct}%</span>
                              </span>
                              <span className="text-[11.5px] font-semibold text-ink tabular-nums shrink-0">{fmtCurrencyFull(c.net)}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-2.5 text-[10px] text-ink/50 tabular-nums">
                              <span>
                                {c.booking_count} booking · {c.malam} malam
                              </span>
                              <span>Kotor {fmtCurrencyFull(c.gross)}</span>
                              <span className="text-ruby-500">{c.ota_deduction > 0 ? `−${fmtCurrencyFull(c.ota_deduction)}` : "tanpa potongan"}</span>
                            </div>
                            {c.menginap_lama.map((s) => (
                              <div key={`${c.sumber}-${s.unit_nomor}-${s.guest_nama}`} className="mt-1.5 text-[10px] text-gold-700 leading-relaxed">
                                ↳ termasuk 1 booking <strong>{s.malam} malam</strong>: Unit {s.unit_nomor ?? "—"} · {s.guest_nama ?? "—"} · {fmtDate(s.tgl_checkin)} s/d{" "}
                                {s.tgl_checkout ? fmtDate(s.tgl_checkout) : "—"} · bersih {fmtCurrencyFull(s.bersih)} (≈ {fmtCurrencyFull(s.bersih_per_malam)}/malam) -- seluruh
                                nilainya tercatat di tanggal check-in ini.
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="px-3 sm:px-4 py-2.5 bg-ink/[0.025] flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px]">
              <span className="font-semibold text-ink/80">
                Total · {tot.booking} booking · {tot.malam} malam
              </span>
              <span className="flex flex-wrap gap-x-3 tabular-nums">
                <span className="text-ink/60">Kotor {fmtCurrencyFull(tot.gross)}</span>
                <span className="text-ruby-500">−{fmtCurrencyFull(tot.ota)}</span>
                <span className="font-semibold text-ink">Bersih {fmtCurrencyFull(tot.net)}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pb-3 pt-1 text-[10px] text-ink/40 leading-relaxed">
        Nilai = total seluruh masa inap, dicatat di tanggal check-in. Kotor = Grand Total Cloudbeds. Bersih = uang yang ditransfer OTA: &quot;Deposit
        Amount&quot; Cloudbeds dikurangi komisi OTA per channel (Konfigurasi Settlement OTA); potongan OTA = selisih kotor dan bersih. Channel yang komisinya
        belum diisi dihitung 0%. Booking website/walk-in tidak punya fee OTA. Pajak/biaya bank tidak termasuk.
        {channels.bersih_belum_tersedia > 0 && (
          <span className="text-ruby-500">
            {" "}
            {channels.bersih_belum_tersedia} booking OTA belum punya harga kamar dari Cloudbeds -- bersihnya sementara dihitung sama dengan kotor.
          </span>
        )}
      </div>
    </Card>
  );
}

function TabelTanggal({ data: channels }: { data: FinanceChannelBreakdown }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr className="text-left text-ink/40 border-b border-ink/10">
            <th className="px-4 py-2">Tanggal / Channel</th>
            <th className="px-3 py-2">Booking</th>
            <th className="px-3 py-2">Malam</th>
            <th className="px-3 py-2">Kotor</th>
            <th className="px-3 py-2">Potongan OTA</th>
            <th className="px-3 py-2">Bersih</th>
          </tr>
        </thead>
        <tbody>
          {channels.by_date.map((d) => (
            <Fragment key={d.tgl_checkin}>
              <tr className="border-t border-ink/10 bg-ink/[0.02] font-semibold text-ink/80">
                <td className="px-4 py-2 whitespace-nowrap">{fmtDate(d.tgl_checkin)}</td>
                <td className="px-3 py-2">{d.booking_count}</td>
                <td className="px-3 py-2">{d.malam}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtCurrencyFull(d.gross)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-ruby-500">{d.ota_deduction > 0 ? `−${fmtCurrencyFull(d.ota_deduction)}` : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtCurrencyFull(d.net)}</td>
              </tr>
              {d.channels.map((c) => (
                <Fragment key={`${d.tgl_checkin}-${c.sumber}`}>
                  <tr className="border-b border-ink/5 text-ink/70">
                    <td className="pl-8 pr-3 py-1.5 whitespace-nowrap">
                      {c.sumber}
                      <span className="text-ink/50"> · komisi {c.commission_pct}%</span>
                    </td>
                    <td className="px-3 py-1.5">{c.booking_count}</td>
                    <td className="px-3 py-1.5">{c.malam}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtCurrencyFull(c.gross)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ruby-500">{c.ota_deduction > 0 ? `−${fmtCurrencyFull(c.ota_deduction)}` : "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtCurrencyFull(c.net)}</td>
                  </tr>
                  {c.menginap_lama.map((s) => (
                    <tr key={`${d.tgl_checkin}-${c.sumber}-${s.unit_nomor}-${s.guest_nama}`} className="border-b border-ink/5">
                      <td colSpan={6} className="pl-12 pr-3 py-1 text-[10px] text-gold-700">
                        ↳ termasuk 1 booking <strong>{s.malam} malam</strong>: Unit {s.unit_nomor ?? "—"} · {s.guest_nama ?? "—"} · {fmtDate(s.tgl_checkin)} s/d{" "}
                        {s.tgl_checkout ? fmtDate(s.tgl_checkout) : "—"} · bersih {fmtCurrencyFull(s.bersih)} (≈ {fmtCurrencyFull(s.bersih_per_malam)}/malam) --
                        seluruh nilainya tercatat di tanggal check-in ini.
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-ink/20 font-semibold text-ink/80">
            <td className="px-4 py-2.5">Total</td>
            <td className="px-3 py-2.5">{channels.by_date.reduce((s, d) => s + d.booking_count, 0)}</td>
            <td className="px-3 py-2.5">{channels.by_date.reduce((s, d) => s + d.malam, 0)}</td>
            <td className="px-3 py-2.5 whitespace-nowrap">{fmtCurrencyFull(channels.by_date.reduce((s, d) => s + d.gross, 0))}</td>
            <td className="px-3 py-2.5 whitespace-nowrap text-ruby-500">−{fmtCurrencyFull(channels.by_date.reduce((s, d) => s + d.ota_deduction, 0))}</td>
            <td className="px-3 py-2.5 whitespace-nowrap">{fmtCurrencyFull(channels.by_date.reduce((s, d) => s + d.net, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
