"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { FinanceShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrencyFull, fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { FinanceChecklistItem, TutupBukuDaftar, TutupBukuDetail } from "@/lib/types";
import { LABEL_UMUR, URUTAN_UMUR, bandingkanDenganSnapshot, piutangPerOta, type BarisPiutang, type UmurPiutang } from "@/lib/tutupBuku";

/**
 * Tutup buku bulanan (owner 2026-11-01): "agar financenya dapat tutup buku
 * dan melihat mana saja yang belum cair dari OTA mana saja di bulan itu",
 * plus bantuan untuk mengetahui yang mana belum cair (pilihan owner: daftar
 * per OTA + umur), dan "fitur penandanya dan berapa totalnya agar finance
 * tutup buku dengan sisa piutang dari OTA yang belum masuk uangnya".
 *
 * Dasar bulan = bulan CHECK-IN (pilihan owner), angka = Checklist Dana Masuk
 * (finance_settlements). Dana yang cair setelah tutup buku tetap dicentang di
 * Checklist Dana; halaman ini menandainya dengan membandingkan snapshot saat
 * tutup buku dengan data hari ini.
 */

function namaBulan(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function bulanSebelumnya(ym: string, mundur: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - mundur, 1)).toISOString().slice(0, 7);
}

const WARNA_UMUR: Record<UmurPiutang, string> = {
  lewat_30: "text-ruby-500",
  lewat_8_30: "text-ruby-400",
  lewat_1_7: "text-gold-500",
  belum_jatuh_tempo: "text-ink/60",
  tanpa_tanggal: "text-ink/40",
};

export default function TutupBukuPage() {
  const bulanIni = todayISO().slice(0, 7);
  const [periode, setPeriode] = useState(bulanSebelumnya(bulanIni, 1));
  const [daftar, setDaftar] = useState<TutupBukuDaftar | null>(null);
  const [detail, setDetail] = useState<TutupBukuDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"tutup" | "buka" | null>(null);
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set());
  const loadSeq = useRef(0);

  function load() {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<TutupBukuDetail>(`/finance/tutup-buku/detail?periode=${periode}`),
      api.get<TutupBukuDaftar>(`/finance/tutup-buku`).catch(() => null),
    ])
      .then(([d, l]) => {
        if (seq !== loadSeq.current) return;
        setDetail(d);
        if (l) setDaftar(l);
      })
      .catch((e) => {
        if (seq === loadSeq.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [periode]);

  const pilihanBulan = useMemo(() => Array.from({ length: 24 }, (_, i) => bulanSebelumnya(bulanIni, i)), [bulanIni]);
  const statusPer = useMemo(() => new Map((daftar?.daftar ?? []).map((r) => [r.periode, r.status])), [daftar]);

  const record = detail?.record ?? null;
  const ditutup = record?.status === "ditutup";
  const live = detail?.live;
  const today = live?.today ?? todayISO();
  const belumCair = useMemo(() => (live?.items ?? []).filter((i) => !i.masuk), [live]);
  const perOta = useMemo(() => piutangPerOta(belumCair, today), [belumCair, today]);
  const banding = useMemo(
    () => (record ? bandingkanDenganSnapshot(record.snapshot.piutang ?? [], live?.items ?? []) : null),
    [record, live],
  );

  // Per OTA: piutang saat tutup buku, yang cair setelahnya, sisa sekarang.
  const perOtaSnapshot = useMemo(() => {
    if (!record || !banding) return [];
    const map = new Map<string, { sumber: string; saat_tutup: number; count_saat_tutup: number; cair: number; count_cair: number; sisa: number; count_sisa: number }>();
    const ambil = (s: string | null) => {
      const k = s ?? "-";
      if (!map.has(k)) map.set(k, { sumber: k, saat_tutup: 0, count_saat_tutup: 0, cair: 0, count_cair: 0, sisa: 0, count_sisa: 0 });
      return map.get(k)!;
    };
    for (const p of record.snapshot.piutang ?? []) {
      const g = ambil(p.sumber);
      g.saat_tutup += p.seharusnya;
      g.count_saat_tutup++;
    }
    for (const i of banding.cair_setelah_tutup) {
      const g = ambil(i.sumber);
      g.cair += i.amount_received ?? 0;
      g.count_cair++;
    }
    for (const i of belumCair) {
      const g = ambil(i.sumber);
      g.sisa += i.seharusnya;
      g.count_sisa++;
    }
    return [...map.values()].sort((a, b) => b.saat_tutup - a.saat_tutup || b.sisa - a.sisa);
  }, [record, banding, belumCair]);

  function toggleOta(s: string) {
    setTerbuka((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const t = live?.totals;

  return (
    <FinanceShell pageTitle="Tutup Buku" pageSub="Tutup buku per bulan check-in dengan sisa piutang OTA yang belum cair">
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <label className="text-[10px] text-ink/40">
          Bulan check-in
          <select className={`${inputCls} block`} value={periode} onChange={(e) => setPeriode(e.target.value)}>
            {pilihanBulan.map((b) => (
              <option key={b} value={b}>
                {namaBulan(b)}
                {statusPer.get(b) === "ditutup" ? " · sudah ditutup" : b === bulanIni ? " · berjalan" : ""}
              </option>
            ))}
          </select>
        </label>
        {detail && !loading && (
          <div className="flex gap-2 items-center mb-1">
            {ditutup ? (
              <>
                <Badge tone="ok">Sudah tutup buku</Badge>
                <Btn onClick={() => setModal("buka")}>Buka kembali</Btn>
              </>
            ) : detail.bisa_ditutup ? (
              <>
                <Badge tone="pending">{record ? "Dibuka kembali" : "Belum tutup buku"}</Badge>
                <Btn variant="primary" onClick={() => setModal("tutup")}>
                  Tutup buku {namaBulan(periode)}
                </Btn>
              </>
            ) : (
              <span className="text-[10.5px] text-ink/40">Bulan berjalan, bisa ditutup setelah bulan selesai.</span>
            )}
          </div>
        )}
      </div>

      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      {loading && <Loading />}

      {!loading && detail && live && t && (
        <>
          {record && (
            <Card className={`mb-4 ${ditutup ? "border-sage-500/40" : "border-gold-500/40"}`}>
              <div className="px-4 py-3 text-[11.5px] text-ink/70 space-y-1">
                <div>
                  {ditutup ? "Ditutup" : "Terakhir ditutup"} oleh <b>{record.ditutup_oleh_nama ?? "-"}</b> pada {fmtDateTime(record.ditutup_at)}. Saat itu:
                  seharusnya {fmtCurrencyFull(record.total_seharusnya)}, sudah masuk {fmtCurrencyFull(record.total_diterima)},{" "}
                  <b>sisa piutang OTA {fmtCurrencyFull(record.total_piutang)}</b> ({record.jumlah_booking_piutang} booking).
                </div>
                {record.catatan && <div className="text-ink/50">Catatan: {record.catatan}</div>}
                {!ditutup && record.dibuka_at && (
                  <div className="text-gold-500">
                    Dibuka kembali oleh {record.dibuka_oleh_nama ?? "-"} pada {fmtDateTime(record.dibuka_at)}: {record.alasan_buka}
                  </div>
                )}
              </div>
            </Card>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard label="Seharusnya masuk" value={fmtCurrencyFull(t.seharusnya)} sub={`${t.count} booking check-in ${namaBulan(periode)}`} />
            <StatCard label="Sudah masuk" value={fmtCurrencyFull(t.diterima)} accent="sage" sub={`${t.count_masuk} booking dicentang`} />
            <StatCard
              label={ditutup ? "Sisa piutang OTA sekarang" : "Piutang OTA (belum cair)"}
              value={fmtCurrencyFull(t.belum)}
              accent="ruby"
              sub={`${t.count_belum} booking · ${t.count_lewat_jatuh_tempo} lewat perkiraan cair`}
            />
            {banding ? (
              <StatCard
                label="Cair setelah tutup buku"
                value={fmtCurrencyFull(banding.total_cair_setelah_tutup)}
                accent="azure"
                sub={`${banding.cair_setelah_tutup.length} dari ${record!.jumlah_booking_piutang} booking piutang`}
              />
            ) : (
              <StatCard label="Selisih tercatat" value={fmtCurrencyFull(t.selisih)} sub="nilai mutasi vs seharusnya" />
            )}
          </div>

          {banding && (banding.belum_cair_baru.length > 0 || banding.hilang.length > 0) && (
            <Card className="mb-4 border-ruby-500/40">
              <div className="px-4 py-3 text-[11px] text-ink/70 space-y-1">
                {banding.belum_cair_baru.length > 0 && (
                  <div>
                    <b>{banding.belum_cair_baru.length} booking</b> belum cair sekarang tetapi tidak ada di daftar piutang saat tutup buku
                    (centangnya dibatalkan, atau booking baru tercatat setelah tutup buku): {banding.belum_cair_baru.map((i) => i.guest_nama).join(", ")}.
                  </div>
                )}
                {banding.hilang.length > 0 && (
                  <div>
                    <b>{banding.hilang.length} booking</b> piutang saat tutup buku sudah tidak ada di bulan ini (dibatalkan atau pindah tanggal):{" "}
                    {banding.hilang.map((i) => `${i.guest_nama} (${fmtCurrencyFull(i.seharusnya)})`).join(", ")}.
                  </div>
                )}
                <div className="text-ink/40">Kalau perubahan ini benar, buka kembali lalu tutup buku lagi supaya angka saat tutup ikut diperbarui.</div>
              </div>
            </Card>
          )}

          {record && perOtaSnapshot.length > 0 && (
            <Card className="mb-4">
              <CardHeader title="Piutang OTA sejak tutup buku" subtitle="Per channel: piutang saat tutup buku, yang sudah cair sesudahnya, dan sisanya sekarang" />
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-ink/55 text-[9.5px] uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Channel</th>
                      <th className="text-right px-4 py-2">Piutang saat tutup</th>
                      <th className="text-right px-4 py-2">Cair setelah tutup</th>
                      <th className="text-right px-4 py-2">Sisa piutang sekarang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perOtaSnapshot.map((g) => (
                      <tr key={g.sumber} className="border-t border-ink/[0.05] text-ink/70">
                        <td className="px-4 py-2">{g.sumber}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {fmtCurrencyFull(g.saat_tutup)} <span className="text-ink/50">({g.count_saat_tutup})</span>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap text-azure-500">
                          {fmtCurrencyFull(g.cair)} <span className="text-ink/50">({g.count_cair})</span>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap font-medium">
                          {fmtCurrencyFull(g.sisa)} <span className="text-ink/50">({g.count_sisa})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="mb-4">
            <CardHeader
              title="Bantuan: yang belum cair per OTA"
              subtitle="Dikelompokkan menurut umur, dihitung dari perkiraan tanggal cair. Klik channel untuk melihat booking-nya."
            />
            {perOta.length === 0 ? (
              <Empty label="Semua dana booking check-in bulan ini sudah dicentang masuk." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-ink/55 text-[9.5px] uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Channel</th>
                      <th className="text-right px-4 py-2">Belum cair</th>
                      {URUTAN_UMUR.map((u) => (
                        <th key={u} className="text-right px-3 py-2 whitespace-nowrap">
                          {LABEL_UMUR[u]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {perOta.map((g) => {
                      const buka = terbuka.has(g.sumber);
                      return (
                        <Fragment key={g.sumber}>
                          <tr className="border-t border-ink/[0.05] text-ink/70 cursor-pointer hover:bg-ink/[0.02]" onClick={() => toggleOta(g.sumber)}>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <span className="text-ink/50 mr-1">{buka ? "▾" : "▸"}</span>
                              {g.sumber}
                            </td>
                            <td className="px-4 py-2 text-right whitespace-nowrap font-medium">
                              {fmtCurrencyFull(g.total)} <span className="text-ink/50">({g.count})</span>
                            </td>
                            {URUTAN_UMUR.map((u) => (
                              <td key={u} className={`px-3 py-2 text-right whitespace-nowrap ${g.per_umur[u].count ? WARNA_UMUR[u] : "text-ink/20"}`}>
                                {g.per_umur[u].count ? (
                                  <>
                                    {fmtCurrencyFull(g.per_umur[u].total)} <span className="text-ink/50">({g.per_umur[u].count})</span>
                                  </>
                                ) : (
                                  "-"
                                )}
                              </td>
                            ))}
                          </tr>
                          {buka && (
                            <tr>
                              <td colSpan={2 + URUTAN_UMUR.length} className="px-4 pb-3 pt-1 bg-ink/[0.015]">
                                <DaftarBooking baris={g.baris} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 text-[10.5px] text-ink/55 border-t border-ink/[0.05] space-y-1">
              <div>
                Cara memakai: mulai dari kolom &quot;Lewat &gt; 30 hari&quot; dan &quot;Lewat 8-30 hari&quot;. Cari No. reservasi Cloudbeds di laporan payout OTA
                (extranet Booking.com / Agoda / Traveloka). Kalau ada di payout dan dananya sudah di mutasi bank, centang di{" "}
                <Link href="/finance/checklist-dana" className="underline">
                  Checklist Dana Masuk
                </Link>
                . Kalau tidak ada di payout, tanyakan ke support OTA dengan nomor reservasi itu.
              </div>
              <div>
                &quot;Tanggal cair belum diatur&quot; = channel ini belum punya jadwal di Konfigurasi Settlement OTA, jadi umurnya tidak bisa dihitung.
                &quot;Seharusnya&quot; memakai komisi rata-rata, jadi bisa sedikit berbeda dari nilai transfer.
              </div>
            </div>
          </Card>

          {banding && banding.cair_setelah_tutup.length > 0 && (
            <Card className="mb-4">
              <CardHeader
                title={`Cair setelah tutup buku · ${fmtCurrencyFull(banding.total_cair_setelah_tutup)}`}
                subtitle="Belum cair saat bulan ini ditutup, sekarang sudah dicentang masuk di Checklist Dana"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-ink/55 text-[9.5px] uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Tamu / Unit</th>
                      <th className="text-left px-4 py-2">Channel</th>
                      <th className="text-left px-4 py-2">Check-in</th>
                      <th className="text-right px-4 py-2">Seharusnya</th>
                      <th className="text-right px-4 py-2">Masuk</th>
                      <th className="text-left px-4 py-2">Tanggal masuk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {banding.cair_setelah_tutup.map((i) => (
                      <tr key={i.booking_id} className="border-t border-ink/[0.05] text-ink/70">
                        <td className="px-4 py-2">
                          {i.guest_nama} <Badge tone="ok">cair setelah tutup buku</Badge>
                          <div className="text-ink/50 text-[10px]">Unit {i.unit_nomor ?? "-"}</div>
                        </td>
                        <td className="px-4 py-2">{i.sumber ?? "-"}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{fmtDate(i.tgl_checkin)}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">{fmtCurrencyFull(i.seharusnya)}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap text-sage-500">{fmtCurrencyFull(i.amount_received)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{fmtDate(i.received_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <RiwayatTutupBuku daftar={daftar} aktif={periode} onPilih={setPeriode} />

          {modal === "tutup" && (
            <TutupModal
              periode={periode}
              totals={t}
              perOta={perOta.map((g) => ({ sumber: g.sumber, total: g.total, count: g.count }))}
              onClose={() => setModal(null)}
              onDone={() => {
                setModal(null);
                load();
              }}
            />
          )}
          {modal === "buka" && (
            <BukaModal
              periode={periode}
              onClose={() => setModal(null)}
              onDone={() => {
                setModal(null);
                load();
              }}
            />
          )}
        </>
      )}

    </FinanceShell>
  );
}

function DaftarBooking({ baris }: { baris: BarisPiutang<FinanceChecklistItem>[] }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-ink/55 text-[9px] uppercase tracking-wide">
          <th className="text-left px-2 py-1.5">No. reservasi</th>
          <th className="text-left px-2 py-1.5">Tamu / Unit</th>
          <th className="text-left px-2 py-1.5">Check-in / out</th>
          <th className="text-right px-2 py-1.5">Seharusnya</th>
          <th className="text-left px-2 py-1.5">Perkiraan cair</th>
          <th className="text-left px-2 py-1.5">Umur</th>
        </tr>
      </thead>
      <tbody>
        {baris.map(({ item: i, umur, hari_lewat }) => (
          <tr key={i.booking_id} className="border-t border-ink/[0.05] text-ink/70">
            <td className="px-2 py-1.5 font-mono text-[10.5px]">{i.cloudbeds_reservation_id ?? "-"}</td>
            <td className="px-2 py-1.5">
              {i.guest_nama}
              <span className="text-ink/50"> · Unit {i.unit_nomor ?? "-"}</span>
            </td>
            <td className="px-2 py-1.5 whitespace-nowrap">
              {fmtDate(i.tgl_checkin)} – {fmtDate(i.tgl_checkout)}
            </td>
            <td className="px-2 py-1.5 text-right whitespace-nowrap">{fmtCurrencyFull(i.seharusnya)}</td>
            <td className="px-2 py-1.5 whitespace-nowrap">{i.expected_settlement_date ? fmtDate(i.expected_settlement_date) : "Belum diatur"}</td>
            <td className={`px-2 py-1.5 whitespace-nowrap ${WARNA_UMUR[umur]}`}>
              {hari_lewat == null ? "-" : hari_lewat > 0 ? `lewat ${hari_lewat} hari` : hari_lewat === 0 ? "jatuh tempo hari ini" : `${-hari_lewat} hari lagi`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RiwayatTutupBuku({ daftar, aktif, onPilih }: { daftar: TutupBukuDaftar | null; aktif: string; onPilih: (p: string) => void }) {
  return (
    <Card>
      <CardHeader title="Riwayat Tutup Buku" subtitle="Angka piutang = saat bulan itu ditutup. Klik bulan untuk melihat sisa piutang sekarang." />
      {!daftar || daftar.daftar.length === 0 ? (
        <Empty label="Belum ada bulan yang ditutup." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-ink/55 text-[9.5px] uppercase tracking-wide">
                <th className="text-left px-4 py-2">Bulan</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Seharusnya</th>
                <th className="text-right px-4 py-2">Sudah masuk</th>
                <th className="text-right px-4 py-2">Piutang saat tutup</th>
                <th className="text-left px-4 py-2">Ditutup</th>
              </tr>
            </thead>
            <tbody>
              {daftar.daftar.map((r) => (
                <tr
                  key={r.periode}
                  className={`border-t border-ink/[0.05] text-ink/70 cursor-pointer hover:bg-ink/[0.02] ${r.periode === aktif ? "bg-gold-500/5" : ""}`}
                  onClick={() => onPilih(r.periode)}
                >
                  <td className="px-4 py-2 whitespace-nowrap">{namaBulan(r.periode)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={r.status === "ditutup" ? "ok" : "pending"}>{r.status === "ditutup" ? "Ditutup" : "Dibuka kembali"}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{fmtCurrencyFull(r.total_seharusnya)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{fmtCurrencyFull(r.total_diterima)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {fmtCurrencyFull(r.total_piutang)} <span className="text-ink/50">({r.jumlah_booking_piutang})</span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-ink/50">
                    {fmtDateTime(r.ditutup_at)} · {r.ditutup_oleh_nama ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TutupModal({
  periode,
  totals,
  perOta,
  onClose,
  onDone,
}: {
  periode: string;
  totals: TutupBukuDetail["live"]["totals"];
  perOta: { sumber: string; total: number; count: number }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simpan() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/finance/tutup-buku/tutup`, { periode, catatan: catatan.trim() || undefined });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Tutup buku ${namaBulan(periode)}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Batal</Btn>
          <Btn variant="primary" disabled={busy} onClick={simpan}>
            Tutup buku
          </Btn>
        </>
      }
    >
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      <div className="text-[11.5px] text-ink/70 space-y-1 mb-4">
        <div>Seharusnya masuk: {fmtCurrencyFull(totals.seharusnya)} ({totals.count} booking)</div>
        <div>Sudah masuk: {fmtCurrencyFull(totals.diterima)} ({totals.count_masuk} booking)</div>
        <div>
          <b>
            Sisa piutang OTA: {fmtCurrencyFull(totals.belum)} ({totals.count_belum} booking)
          </b>
        </div>
        {perOta.length > 0 && (
          <ul className="pl-4 list-disc text-ink/55">
            {perOta.map((g) => (
              <li key={g.sumber}>
                {g.sumber}: {fmtCurrencyFull(g.total)} ({g.count} booking)
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="text-[10.5px] text-ink/45 mb-4">
        Angka dan daftar booking yang belum cair disimpan apa adanya. Dana yang cair setelah ini tetap dicentang di Checklist Dana Masuk dan akan
        ditandai &quot;cair setelah tutup buku&quot; di halaman ini.
      </div>
      <Field label="Catatan (opsional)">
        <input className={inputCls} value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={1000} />
      </Field>
    </Modal>
  );
}

function BukaModal({ periode, onClose, onDone }: { periode: string; onClose: () => void; onDone: () => void }) {
  const [alasan, setAlasan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simpan() {
    if (!alasan.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/finance/tutup-buku/buka`, { periode, alasan: alasan.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Buka kembali ${namaBulan(periode)}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Batal</Btn>
          <Btn variant="primary" disabled={busy || !alasan.trim()} onClick={simpan}>
            Buka kembali
          </Btn>
        </>
      }
    >
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      <div className="text-[11px] text-ink/50 mb-4">
        Bulan ini kembali berstatus belum ditutup sampai ditutup lagi. Angka saat tutup buku sebelumnya dan alasan ini tercatat di riwayat perubahan.
      </div>
      <Field label="Alasan (wajib)">
        <input className={inputCls} value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={1000} placeholder="mis. ada booking yang terlewat" />
      </Field>
    </Modal>
  );
}
