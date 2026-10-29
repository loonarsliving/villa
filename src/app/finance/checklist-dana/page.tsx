"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FinanceShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrencyFull, fmtDate, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { FinanceChecklist, FinanceChecklistItem } from "@/lib/types";
import { kelompokkanPerPencairan, rentangCheckinUntukPencairan, type PencairanGroup } from "@/lib/financePencairan";
import type { MutasiBaris } from "@/lib/mutasiBank";
import { MutasiBankCard } from "./_MutasiBank";

/**
 * Checklist dana masuk (owner 2026-10-07): "checklist manual dana yg masuk
 * dan belum ... jd finance bisa crosscheck 2 arah".
 *
 * Arah 1 (sistem -> bank): setiap pemasukan yang sudah diakui punya angka
 * bersih yang seharusnya masuk rekening. Yang belum dicentang = belum
 * terlihat di mutasi bank.
 * Arah 2 (bank -> sistem): satu transfer OTA di mutasi biasanya membayar
 * beberapa booking. Finance memilih booking-booking itu, mengetik nilai
 * transfer dari mutasi, dan halaman ini menunjukkan selisihnya sebelum
 * dicentang.
 *
 * Datanya finance_settlements yang sudah ada (sama dengan "Mark as
 * Received" di detail booking), jadi centang di sini dan di sana selalu
 * sama.
 */

type StatusFilter = "semua" | "belum" | "masuk";

/**
 * Pilihan bulan: 24 bulan ke belakang sampai 2 bulan ke depan. Dulu
 * `<input type="month">`, yang di Safari & Firefox desktop jatuh jadi kotak
 * teks biasa: setiap ketikan ("2026-1", lalu "2026-10") memicu load, dan
 * jawaban bulan setengah-jadi bisa datang terakhir lalu menimpa data bulan
 * yang benar (log produksi 2026-10-27: from=2026-1-01, 2026--01, 2026-19-01).
 */
function pilihanBulan(sekarang: string): string[] {
  const [y, m] = sekarang.split("-").map(Number);
  const out: string[] = [];
  for (let i = 2; i >= -24; i--) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function namaBulan(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${ym}-01`, to: last };
}

export default function ChecklistDanaPage() {
  const [bulan, setBulan] = useState(todayISO().slice(0, 7));
  const [sumber, setSumber] = useState("");
  const [status, setStatus] = useState<StatusFilter>("belum");
  const [data, setData] = useState<FinanceChecklist | null>(null);
  // Data terpisah untuk total per tanggal cair -- check-in-nya bisa jatuh di
  // bulan sebelumnya, lihat src/lib/financePencairan.ts.
  const [dataCair, setDataCair] = useState<FinanceChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nilaiMutasi, setNilaiMutasi] = useState("");
  const [tglMasuk, setTglMasuk] = useState(todayISO());
  const [refBank, setRefBank] = useState("");
  const [busy, setBusy] = useState(false);

  const [tandai, setTandai] = useState<FinanceChecklistItem | null>(null);
  const [batal, setBatal] = useState<FinanceChecklistItem | null>(null);

  // Ganti bulan cepat memicu dua load bersamaan; hanya jawaban load terakhir
  // yang boleh dipakai (pola sama dengan _Dashboard.tsx).
  const loadSeq = useRef(0);

  function load() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan)) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    const { from, to } = monthRange(bulan);
    const cair = rentangCheckinUntukPencairan(bulan);
    Promise.all([
      api.get<FinanceChecklist>(`/finance/checklist-dana?from=${from}&to=${to}`),
      // Gagal mengambil total per pencairan tidak boleh menutup daftar utama.
      api.get<FinanceChecklist>(`/finance/checklist-dana?from=${cair.from}&to=${cair.to}`).catch(() => null),
    ])
      .then(([d, dc]) => {
        if (seq !== loadSeq.current) return;
        setData(d);
        setDataCair(dc);
        setSelected(new Set());
      })
      .catch((e) => {
        if (seq === loadSeq.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [bulan]);
  const daftarBulan = useMemo(() => pilihanBulan(todayISO().slice(0, 7)), []);

  const sumberList = useMemo(() => [...new Set((data?.items ?? []).map((i) => i.sumber ?? "-"))].sort(), [data]);

  const items = useMemo(() => {
    let list = data?.items ?? [];
    if (sumber) list = list.filter((i) => (i.sumber ?? "-") === sumber);
    if (status === "belum") list = list.filter((i) => !i.masuk);
    if (status === "masuk") list = list.filter((i) => i.masuk);
    return list;
  }, [data, sumber, status]);

  const pencairan = useMemo(() => {
    if (!dataCair) return [];
    const list = sumber ? dataCair.items.filter((i) => (i.sumber ?? "-") === sumber) : dataCair.items;
    return kelompokkanPerPencairan(list, bulan, dataCair.today);
  }, [dataCair, sumber, bulan]);
  // Mutasi dicocokkan dengan SEMUA channel, tidak ikut filter channel di atas.
  const pencairanSemua = useMemo(
    () => (dataCair ? kelompokkanPerPencairan(dataCair.items, bulan, dataCair.today) : []),
    [dataCair, bulan],
  );

  // Booking yang dipilih lewat kartu pencairan bisa check-in di bulan lain,
  // jadi dicari di kedua data.
  const selectedItems = useMemo(() => {
    const byId = new Map<string, FinanceChecklistItem>();
    for (const i of [...(dataCair?.items ?? []), ...(data?.items ?? [])]) byId.set(i.booking_id, i);
    return [...selected].map((id) => byId.get(id)).filter((i): i is FinanceChecklistItem => !!i);
  }, [data, dataCair, selected]);
  const selectedTotal = selectedItems.reduce((a, i) => a + i.seharusnya, 0);
  const mutasi = nilaiMutasi ? Number(nilaiMutasi) : null;
  const selisih = mutasi != null ? mutasi - selectedTotal : null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const belumDiList = items.filter((i) => !i.masuk);
  const semuaDipilih = belumDiList.length > 0 && belumDiList.every((i) => selected.has(i.booking_id));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (semuaDipilih) belumDiList.forEach((i) => next.delete(i.booking_id));
      else belumDiList.forEach((i) => next.add(i.booking_id));
      return next;
    });
  }

  function pilihPencairan(g: PencairanGroup) {
    setSelected(new Set(g.items.filter((i) => !i.masuk).map((i) => i.booking_id)));
    setNilaiMutasi("");
    setTglMasuk(g.tanggal <= todayISO() ? g.tanggal : todayISO());
  }

  function pakaiMutasi(g: PencairanGroup, baris: MutasiBaris) {
    setSelected(new Set(g.items.filter((i) => !i.masuk).map((i) => i.booking_id)));
    setNilaiMutasi(String(baris.nominal));
    setTglMasuk(baris.tanggal);
    setRefBank(baris.keterangan.slice(0, 100));
  }

  async function tandaiTerpilih() {
    if (!selected.size || !tglMasuk) return;
    setBusy(true);
    setError(null);
    try {
      const notes =
        mutasi != null && selisih !== 0
          ? `Satu transfer ${fmtCurrencyFull(mutasi)} untuk ${selected.size} booking (total seharusnya ${fmtCurrencyFull(selectedTotal)})`
          : undefined;
      await api.post(`/finance/settlements/receive-bulk`, {
        booking_ids: [...selected],
        received_date: tglMasuk,
        bank_reference: refBank || undefined,
        // Nilai mutasi asli dibagi villa-api ke booking terpilih; selisihnya tercatat per booking.
        total_diterima: mutasi != null && mutasi > 0 ? mutasi : undefined,
        notes,
      });
      setNilaiMutasi("");
      setRefBank("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const t = data?.totals;

  return (
    <FinanceShell pageTitle="Checklist Dana Masuk" pageSub="Centang manual dana yang sudah masuk rekening, cocokkan dua arah dengan mutasi bank">
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <label className="text-[10px] text-ink/40">
          Bulan check-in
          <select className={`${inputCls} block`} value={bulan} onChange={(e) => setBulan(e.target.value)}>
            {daftarBulan.map((b) => (
              <option key={b} value={b}>
                {namaBulan(b)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-ink/40">
          Channel
          <select className={`${inputCls} block`} value={sumber} onChange={(e) => setSumber(e.target.value)}>
            <option value="">Semua</option>
            {sumberList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1">
          {(["belum", "masuk", "semua"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`text-[10.5px] px-3 py-1.5 rounded border ${status === s ? "border-gold-500 text-gold-400" : "border-ink/15 text-ink/50"}`}
            >
              {s === "belum" ? "Belum masuk" : s === "masuk" ? "Sudah masuk" : "Semua"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      {loading && <Loading />}

      {!loading && data && t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard label="Seharusnya masuk" value={fmtCurrencyFull(t.seharusnya)} sub={`${t.count} booking, angka bersih`} />
            <StatCard label="Sudah masuk" value={fmtCurrencyFull(t.diterima)} accent="sage" sub={`${t.count_masuk} booking dicentang`} />
            <StatCard label="Belum masuk" value={fmtCurrencyFull(t.belum)} sub={`${t.count_belum} booking belum dicentang`} />
            <StatCard
              label="Lewat perkiraan cair"
              value={String(t.count_lewat_jatuh_tempo)}
              sub={t.selisih ? `Selisih tercatat ${fmtCurrencyFull(t.selisih)}` : "booking belum masuk, sudah lewat tanggal"}
            />
          </div>

          <Card className="mb-4">
            <CardHeader title="Per Channel" subtitle="Seharusnya vs sudah dicentang masuk" />
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-ink/35 text-[9.5px] uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Channel</th>
                    <th className="text-right px-4 py-2">Seharusnya</th>
                    <th className="text-right px-4 py-2">Sudah masuk</th>
                    <th className="text-right px-4 py-2">Belum masuk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.per_channel.map((c) => (
                    <tr key={c.sumber} className="border-t border-ink/[0.05] text-ink/70">
                      <td className="px-4 py-2">{c.sumber}</td>
                      <td className="px-4 py-2 text-right">{fmtCurrencyFull(c.seharusnya)}</td>
                      <td className="px-4 py-2 text-right text-sage-400">
                        {fmtCurrencyFull(c.diterima)} <span className="text-ink/30">({c.count_masuk})</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {fmtCurrencyFull(c.belum)} <span className="text-ink/30">({c.count_belum})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mb-4">
            <CardHeader
              title="Per Tanggal Pencairan"
              subtitle="Satu baris = satu transfer OTA yang diharapkan di mutasi bank. Bulan di atas = bulan tanggal cair, termasuk booking check-in bulan sebelumnya."
            />
            {pencairan.length === 0 ? (
              <Empty label="Tidak ada pencairan yang dijadwalkan di bulan ini." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-ink/35 text-[9.5px] uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Tanggal cair</th>
                      <th className="text-left px-4 py-2">Channel</th>
                      <th className="text-right px-4 py-2">Booking</th>
                      <th className="text-right px-4 py-2">Total seharusnya</th>
                      <th className="text-right px-4 py-2">Sudah masuk</th>
                      <th className="text-right px-4 py-2">Belum masuk</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pencairan.map((g) => {
                      const lewat = g.count_belum > 0 && g.tanggal < dataCair!.today;
                      return (
                        <tr key={g.key} className="border-t border-ink/[0.05] text-ink/70 align-top">
                          <td className={`px-4 py-2 whitespace-nowrap ${lewat ? "text-ruby-400" : ""}`}>
                            {fmtDate(g.tanggal, { weekday: "short", day: "2-digit", month: "short" })}
                            {g.berjalan && <div className="text-ink/30 text-[10px]">masih berjalan</div>}
                            {lewat && <div className="text-[10px]">sudah lewat</div>}
                          </td>
                          <td className="px-4 py-2">{g.sumber}</td>
                          <td className="px-4 py-2 text-right">{g.count}</td>
                          <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{fmtCurrencyFull(g.seharusnya)}</td>
                          <td className="px-4 py-2 text-right text-sage-400 whitespace-nowrap">
                            {fmtCurrencyFull(g.diterima)} <span className="text-ink/30">({g.count_masuk})</span>
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {fmtCurrencyFull(g.belum)} <span className="text-ink/30">({g.count_belum})</span>
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {g.count_belum > 0 ? (
                              <button className="text-[10px] text-gold-400 underline" onClick={() => pilihPencairan(g)}>
                                Cocokkan mutasi
                              </button>
                            ) : (
                              <Badge tone="ok">Lengkap</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 text-[10.5px] text-ink/35 border-t border-ink/[0.05]">
              &quot;Total seharusnya&quot; memakai komisi rata-rata di Konfigurasi Settlement OTA, jadi bisa berbeda sedikit dari nilai transfer.
              Bandingkan juga jumlah booking dengan laporan payout OTA: kalau jumlahnya kurang, ada reservasi yang tidak masuk ke sistem.
              &quot;Masih berjalan&quot; = tanggal cair belum lewat, booking yang check-in-nya belum tiba belum terhitung.
            </div>
          </Card>

          <MutasiBankCard groups={pencairanSemua} bulanLabel={namaBulan(bulan)} onPakai={pakaiMutasi} />

          {selected.size > 0 && (
            <Card className="mb-4 border-gold-500/40">
              <CardHeader
                title={`${selected.size} booking dipilih · ${fmtCurrencyFull(selectedTotal)}`}
                subtitle="Cocokkan dengan satu transfer di mutasi bank, lalu centang sekaligus"
              />
              <div className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <Field label="Nilai di mutasi bank (dicatat sebagai diterima)">
                  <input className={inputCls} type="number" value={nilaiMutasi} onChange={(e) => setNilaiMutasi(e.target.value)} />
                </Field>
                <Field label="Tanggal masuk">
                  <input className={inputCls} type="date" value={tglMasuk} onChange={(e) => setTglMasuk(e.target.value)} />
                </Field>
                <Field label="Referensi bank (opsional)">
                  <input className={inputCls} value={refBank} onChange={(e) => setRefBank(e.target.value)} />
                </Field>
                <div className="mb-5 flex gap-2">
                  <Btn variant="primary" disabled={busy} onClick={tandaiTerpilih}>
                    Tandai {selected.size} masuk
                  </Btn>
                  <Btn onClick={() => setSelected(new Set())}>Batal pilih</Btn>
                </div>
              </div>
              {selisih != null && (
                <div className={`px-4 pb-4 text-[11px] ${selisih === 0 ? "text-sage-400" : "text-ruby-400"}`}>
                  {selisih === 0
                    ? "Cocok: nilai mutasi sama persis dengan total booking yang dipilih."
                    : `Selisih ${fmtCurrencyFull(selisih)} (mutasi ${selisih > 0 ? "lebih besar" : "lebih kecil"} dari total yang dipilih). Kalau booking yang dipilih sudah benar, selisih ini ikut tercatat (dibagi ke booking sebanding angka seharusnya).`}
                </div>
              )}
            </Card>
          )}

          <Card>
            <CardHeader
              title="Daftar Pemasukan"
              subtitle={`Check-in ${fmtDate(data.from)} s/d ${fmtDate(data.to)} yang tanggalnya sudah tiba`}
            />
            {items.length === 0 ? (
              <Empty label={status === "belum" ? "Semua dana di periode ini sudah dicentang masuk." : "Tidak ada data."} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-ink/35 text-[9.5px] uppercase tracking-wide">
                      <th className="px-3 py-2 w-8">
                        {belumDiList.length > 0 && <input type="checkbox" checked={semuaDipilih} onChange={toggleAll} aria-label="Pilih semua" />}
                      </th>
                      <th className="text-left px-3 py-2">Check-in</th>
                      <th className="text-left px-3 py-2">Check-out</th>
                      <th className="text-left px-3 py-2">Tamu / Unit</th>
                      <th className="text-left px-3 py-2">Channel</th>
                      <th className="text-right px-3 py-2">Seharusnya</th>
                      <th className="text-left px-3 py-2">Perkiraan cair</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const lewat = !i.masuk && i.expected_settlement_date && i.expected_settlement_date < data.today;
                      return (
                        <tr key={i.booking_id} className="border-t border-ink/[0.05] text-ink/70 align-top">
                          <td className="px-3 py-2">
                            {!i.masuk && (
                              <input type="checkbox" checked={selected.has(i.booking_id)} onChange={() => toggle(i.booking_id)} aria-label={`Pilih ${i.guest_nama}`} />
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {fmtDate(i.tgl_checkin)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {fmtDate(i.tgl_checkout)}
                            <div className="text-ink/30 text-[10px]">{i.malam} malam</div>
                          </td>
                          <td className="px-3 py-2">
                            {i.guest_nama}
                            <div className="text-ink/30 text-[10px]">Unit {i.unit_nomor ?? "-"}</div>
                          </td>
                          <td className="px-3 py-2">{i.sumber ?? "-"}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {fmtCurrencyFull(i.seharusnya)}
                            {i.kotor !== i.seharusnya && <div className="text-ink/30 text-[10px]">kotor {fmtCurrencyFull(i.kotor)}</div>}
                          </td>
                          <td className={`px-3 py-2 whitespace-nowrap ${lewat ? "text-ruby-400" : ""}`}>
                            {i.expected_settlement_date ? fmtDate(i.expected_settlement_date) : "Belum diatur"}
                            {lewat && <div className="text-[10px]">sudah lewat</div>}
                          </td>
                          <td className="px-3 py-2">
                            {i.masuk ? (
                              <>
                                <Badge tone={i.variance_amount ? "danger" : "ok"}>Sudah masuk</Badge>
                                <div className="text-ink/40 text-[10px] mt-0.5">
                                  {fmtDate(i.received_date)} · {fmtCurrencyFull(i.amount_received)}
                                  {i.variance_amount ? ` (selisih ${fmtCurrencyFull(i.variance_amount)})` : ""}
                                  {i.bank_reference ? ` · ref ${i.bank_reference}` : ""}
                                </div>
                              </>
                            ) : (
                              <Badge tone="pending">Belum masuk</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {i.masuk ? (
                              <button className="text-[10px] text-ink/40 underline" onClick={() => setBatal(i)}>
                                Batalkan
                              </button>
                            ) : (
                              <button className="text-[10px] text-gold-400 underline" onClick={() => setTandai(i)}>
                                Tandai masuk
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 text-[10.5px] text-ink/35 border-t border-ink/[0.05] space-y-1">
              <div>
                &quot;Seharusnya&quot; = angka bersih yang diterima villa (untuk OTA: Deposit Amount Cloudbeds dikurangi komisi OTA di Konfigurasi Settlement OTA; untuk langsung:
                total bayar). Booking yang tanggal check-in-nya belum tiba tidak ada di daftar ini.
              </div>
              <div>
                Satu transfer OTA biasanya membayar beberapa booking: centang booking-booking itu, isi nilai di mutasi bank, dan pastikan
                selisihnya nol sebelum menandai. Kalau nilainya berbeda, gunakan &quot;Tandai masuk&quot; per booking dengan nilai sebenarnya.
              </div>
            </div>
          </Card>
        </>
      )}

      {tandai && <TandaiModal item={tandai} onClose={() => setTandai(null)} onDone={() => { setTandai(null); load(); }} />}
      {batal && <BatalModal item={batal} onClose={() => setBatal(null)} onDone={() => { setBatal(null); load(); }} />}
    </FinanceShell>
  );
}

function TandaiModal({ item, onClose, onDone }: { item: FinanceChecklistItem; onClose: () => void; onDone: () => void }) {
  const [jumlah, setJumlah] = useState(String(item.seharusnya));
  const [tgl, setTgl] = useState(todayISO());
  const [ref, setRef] = useState("");
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simpan() {
    if (!jumlah || !tgl) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/finance/settlements/receive`, {
        booking_id: item.booking_id,
        amount_received: Number(jumlah),
        received_date: tgl,
        bank_reference: ref || undefined,
        notes: catatan || undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const selisih = Number(jumlah || 0) - item.seharusnya;
  return (
    <Modal
      open
      title={`Tandai masuk — ${item.guest_nama}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Batal</Btn>
          <Btn variant="primary" disabled={busy} onClick={simpan}>
            Simpan
          </Btn>
        </>
      }
    >
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      <div className="text-[11px] text-ink/50 mb-4">
        {item.sumber} · Unit {item.unit_nomor ?? "-"} · check-in {fmtDate(item.tgl_checkin)} · seharusnya {fmtCurrencyFull(item.seharusnya)}
      </div>
      <Field label="Jumlah yang masuk (sesuai mutasi)">
        <input className={inputCls} type="number" value={jumlah} onChange={(e) => setJumlah(e.target.value)} />
      </Field>
      {selisih !== 0 && jumlah && <div className="text-ruby-400 text-[11px] -mt-3 mb-4">Selisih {fmtCurrencyFull(selisih)} dari yang seharusnya</div>}
      <Field label="Tanggal masuk">
        <input className={inputCls} type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} />
      </Field>
      <Field label="Referensi bank (opsional)">
        <input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <Field label="Catatan (opsional)">
        <input className={inputCls} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
      </Field>
    </Modal>
  );
}

function BatalModal({ item, onClose, onDone }: { item: FinanceChecklistItem; onClose: () => void; onDone: () => void }) {
  const [alasan, setAlasan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simpan() {
    if (!alasan.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/finance/settlements/unreceive`, { booking_id: item.booking_id, reason: alasan.trim() });
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
      title={`Batalkan centang — ${item.guest_nama}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Tutup</Btn>
          <Btn variant="primary" disabled={busy || !alasan.trim()} onClick={simpan}>
            Batalkan centang
          </Btn>
        </>
      }
    >
      {error && <div className="text-ruby-500 text-xs mb-3">{error}</div>}
      <div className="text-[11px] text-ink/50 mb-4">
        Tercatat masuk {fmtDate(item.received_date)} sebesar {fmtCurrencyFull(item.amount_received)}. Booking ini akan kembali ke daftar
        &quot;Belum masuk&quot;; nilai lama tetap tersimpan di riwayat perubahan.
      </div>
      <Field label="Alasan (wajib)">
        <input className={inputCls} value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah centang, dana belum ada di mutasi" />
      </Field>
    </Modal>
  );
}
