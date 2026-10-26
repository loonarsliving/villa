"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FinanceShell } from "../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, todayISO } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Empty } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { KartuPengajuan, PilihFile } from "@/components/PengajuanBiaya";
import { kodePengajuan, labelPeriode, namaBiaya, rekapPerPeriode, type PengajuanBiaya } from "@/lib/pengajuanBiaya";

interface Respons {
  pengajuan: PengajuanBiaya[];
  menunggu: number;
}

type Aksi = { jenis: "tolak" | "setujui" | "transfer"; p: PengajuanBiaya };

/**
 * Pengajuan biaya dari manager villa (owner 2026-10-26). Finance menyetujui
 * atau menolak, lalu mengunggah bukti transfer; bukti itu ikut tampil di
 * dashboard manager dan di chat Loonars Connect. Rekap per bulan biaya di
 * atas adalah catatan Finance untuk pengeluaran operasional ini.
 */
export default function PengajuanFinancePage() {
  const toast = useToast();
  const [data, setData] = useState<Respons | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [aksi, setAksi] = useState<Aksi | null>(null);
  const [catatan, setCatatan] = useState("");
  const [bukti, setBukti] = useState<string | null>(null);
  const [tanggal, setTanggal] = useState(todayISO());
  const [kirim, setKirim] = useState(false);

  const muat = useCallback(async () => {
    try {
      setData(await api.get<Respons>("/finance/pengajuan"));
      setGalat(null);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat pengajuan");
    }
  }, []);
  useEffect(() => {
    muat();
  }, [muat]);

  function mulai(jenis: Aksi["jenis"], p: PengajuanBiaya) {
    setAksi({ jenis, p });
    setCatatan("");
    setBukti(null);
    setTanggal(todayISO());
  }

  async function jalankan() {
    if (!aksi) return;
    setKirim(true);
    try {
      if (aksi.jenis === "transfer") {
        await api.post("/finance/pengajuan/transfer", { id: aksi.p.id, bukti, tanggal_transfer: tanggal, catatan });
        toast("✓", "Tersimpan", `${kodePengajuan(aksi.p.nomor)} ditandai sudah ditransfer`, "sage");
      } else {
        await api.post("/finance/pengajuan/putuskan", { id: aksi.p.id, keputusan: aksi.jenis, catatan });
        toast("✓", "Tersimpan", `${kodePengajuan(aksi.p.nomor)} ${aksi.jenis === "setujui" ? "disetujui" : "ditolak"}`, "sage");
      }
      setAksi(null);
      muat();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : "Gagal menyimpan", "ruby");
    } finally {
      setKirim(false);
    }
  }

  const list = data?.pengajuan ?? [];
  const antrean = list.filter((p) => p.status === "diajukan" || p.status === "disetujui");
  const selesai = list.filter((p) => !(p.status === "diajukan" || p.status === "disetujui"));
  const rekap = useMemo(() => rekapPerPeriode(list), [list]);
  const bisaKirim =
    aksi?.jenis === "transfer" ? !!bukti && !!tanggal : aksi?.jenis === "tolak" ? catatan.trim().length >= 3 : true;

  return (
    <FinanceShell pageTitle="Pengajuan Biaya" pageSub="Pengajuan laundry, Netflix, dan biaya lain dari manager villa">
      {galat && <div className="text-ruby-500 text-xs mb-3">{galat}</div>}
      {!data && !galat && <Loading />}
      {data && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Rekap per bulan biaya" subtitle="Ditransfer = sudah keluar; menunggu = diajukan/disetujui, belum ditransfer" />
            {rekap.length === 0 ? (
              <Empty label="Belum ada pengajuan." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-ink/40 border-b border-ink/10">
                      <th className="px-4 py-2">Bulan</th>
                      <th className="px-3 py-2">Biaya</th>
                      <th className="px-3 py-2 text-right">Ditransfer</th>
                      <th className="px-3 py-2 text-right">Menunggu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rekap.flatMap((r) => [
                      ...r.perBiaya.map((b, i) => (
                        <tr key={`${r.periode}-${b.nama}`} className="border-b border-ink/5">
                          <td className="px-4 py-2 text-ink/70">{i === 0 ? labelPeriode(r.periode) : ""}</td>
                          <td className="px-3 py-2">{b.nama}</td>
                          <td className="px-3 py-2 text-right">{fmtCurrencyFull(b.ditransfer)}</td>
                          <td className="px-3 py-2 text-right text-ink/50">{fmtCurrencyFull(b.menunggu)}</td>
                        </tr>
                      )),
                      <tr key={`${r.periode}-total`} className="border-b border-ink/10 bg-ink/[0.03] font-semibold">
                        <td className="px-4 py-2" />
                        <td className="px-3 py-2">Total {labelPeriode(r.periode)}</td>
                        <td className="px-3 py-2 text-right">{fmtCurrencyFull(r.ditransfer)}</td>
                        <td className="px-3 py-2 text-right text-ink/50">{fmtCurrencyFull(r.menunggu)}</td>
                      </tr>,
                    ])}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title={`Perlu diproses (${antrean.length})`} subtitle="Setujui/tolak, lalu unggah bukti transfer" />
            <CardBody className="space-y-3">
              {antrean.length === 0 ? (
                <Empty label="Tidak ada pengajuan yang menunggu." />
              ) : (
                antrean.map((p) => (
                  <KartuPengajuan
                    key={p.id}
                    p={p}
                    aksi={
                      <>
                        {p.status === "diajukan" && (
                          <>
                            <Btn onClick={() => mulai("tolak", p)}>Tolak</Btn>
                            <Btn onClick={() => mulai("setujui", p)}>Setujui</Btn>
                          </>
                        )}
                        <Btn variant="primary" onClick={() => mulai("transfer", p)}>
                          {p.status === "diajukan" ? "Setujui & unggah bukti transfer" : "Unggah bukti transfer"}
                        </Btn>
                      </>
                    }
                  />
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Riwayat" subtitle="Sudah ditransfer, ditolak, atau dibatalkan (200 terbaru)" />
            <CardBody className="space-y-3">
              {selesai.length === 0 ? <Empty label="Belum ada riwayat." /> : selesai.map((p) => <KartuPengajuan key={p.id} p={p} />)}
            </CardBody>
          </Card>
        </div>
      )}

      <Modal
        open={!!aksi}
        title={
          aksi
            ? `${aksi.jenis === "tolak" ? "Tolak" : aksi.jenis === "setujui" ? "Setujui" : "Bukti transfer"} — ${kodePengajuan(aksi.p.nomor)}`
            : ""
        }
        onClose={() => setAksi(null)}
        footer={
          <>
            <Btn onClick={() => setAksi(null)}>Kembali</Btn>
            <Btn variant="primary" onClick={jalankan} disabled={kirim || !bisaKirim}>
              {kirim ? "Menyimpan…" : "Simpan"}
            </Btn>
          </>
        }
      >
        {aksi && (
          <>
            <div className="text-[12px] text-ink/70 mb-4">
              {namaBiaya(aksi.p)} · <span className="font-semibold">{fmtCurrencyFull(aksi.p.nominal)}</span>
              {aksi.p.penerima_rekening && (
                <div className="text-[11px] text-ink/50 mt-1">
                  Ke {aksi.p.penerima_bank} {aksi.p.penerima_rekening} a.n {aksi.p.penerima_nama}
                </div>
              )}
            </div>
            {aksi.jenis === "transfer" && (
              <>
                <Field label="Tanggal transfer">
                  <input type="date" className={inputCls} value={tanggal} max={todayISO()} onChange={(e) => setTanggal(e.target.value)} />
                </Field>
                <Field label="Bukti transfer">
                  <PilihFile label="Foto / PDF bukti transfer" value={bukti} onChange={setBukti} wajib />
                </Field>
              </>
            )}
            <Field label={aksi.jenis === "tolak" ? "Alasan penolakan" : "Catatan (opsional)"}>
              <input className={inputCls} maxLength={1000} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
            </Field>
          </>
        )}
      </Modal>
    </FinanceShell>
  );
}
