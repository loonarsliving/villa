"use client";

import { useCallback, useEffect, useState } from "react";
import { ManagerShell } from "../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Empty } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { KartuPengajuan, PilihFile } from "@/components/PengajuanBiaya";
import {
  bacaNominal,
  LABEL_JENIS,
  LABEL_KATEGORI,
  labelPeriode,
  type JenisPengajuan,
  type KategoriPengajuan,
  type PengajuanBiaya,
} from "@/lib/pengajuanBiaya";

interface Respons {
  pengajuan: PengajuanBiaya[];
  periode_boleh: string[];
}

const KOSONG = {
  kategori: "laundry" as KategoriPengajuan,
  kategori_nama: "",
  jenis: "permintaan_dana" as JenisPengajuan,
  periode: "",
  nominal: "",
  keterangan: "",
  penerima_nama: "",
  penerima_bank: "",
  penerima_rekening: "",
};

/**
 * Pengajuan biaya manager (owner 2026-10-26): laundry, Netflix, atau
 * lain-lain (nama biayanya ditulis sendiri). Finance villa menyetujui dan
 * mengunggah bukti transfer di /finance/pengajuan-biaya. Pengajuan yang
 * dikirim lewat chat Loonars Connect juga tampil di sini.
 */
export default function PengajuanManagerPage() {
  const toast = useToast();
  const [data, setData] = useState<Respons | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [form, setForm] = useState<typeof KOSONG | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [buktiBayar, setBuktiBayar] = useState<string | null>(null);
  const [kirim, setKirim] = useState(false);
  const [batal, setBatal] = useState<PengajuanBiaya | null>(null);
  const [alasanBatal, setAlasanBatal] = useState("");

  const muat = useCallback(async () => {
    try {
      setData(await api.get<Respons>("/manager/pengajuan"));
      setGalat(null);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat pengajuan");
    }
  }, []);
  useEffect(() => {
    muat();
  }, [muat]);

  function bukaForm() {
    setForm({ ...KOSONG, periode: data?.periode_boleh[0] ?? "" });
    setNota(null);
    setBuktiBayar(null);
  }

  async function ajukan() {
    if (!form) return;
    const nominal = bacaNominal(form.nominal);
    if (!nominal) return toast("⚠", "Gagal", "Isi nominal", "ruby");
    if (form.kategori === "lain_lain" && form.kategori_nama.trim().length < 3) return toast("⚠", "Gagal", "Tulis nama biayanya", "ruby");
    if (form.jenis === "reimburse" && !buktiBayar) return toast("⚠", "Gagal", "Reimburse wajib melampirkan bukti bayar", "ruby");
    setKirim(true);
    try {
      await api.post("/manager/pengajuan", { ...form, nominal, nota, bukti_bayar: buktiBayar });
      toast("✓", "Berhasil", "Pengajuan terkirim ke Finance", "sage");
      setForm(null);
      muat();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : "Gagal mengirim pengajuan", "ruby");
    } finally {
      setKirim(false);
    }
  }

  async function batalkan() {
    if (!batal) return;
    setKirim(true);
    try {
      await api.post("/manager/pengajuan/batal", { id: batal.id, alasan: alasanBatal });
      toast("✓", "Berhasil", "Pengajuan dibatalkan", "sage");
      setBatal(null);
      setAlasanBatal("");
      muat();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : "Gagal membatalkan", "ruby");
    } finally {
      setKirim(false);
    }
  }

  const list = data?.pengajuan ?? [];
  const berjalan = list.filter((p) => p.status === "diajukan" || p.status === "disetujui");
  const selesai = list.filter((p) => !(p.status === "diajukan" || p.status === "disetujui"));
  const totalMenunggu = berjalan.reduce((s, p) => s + Number(p.nominal), 0);
  const ubah = (k: keyof typeof KOSONG, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <ManagerShell pageTitle="Pengajuan Biaya" pageSub="Laundry, Netflix, dan biaya lain — disetujui dan ditransfer oleh Finance villa">
      {galat && <div className="text-ruby-500 text-xs mb-3">{galat}</div>}
      {!data && !galat && <Loading />}
      {data && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px] text-ink/60">
              {berjalan.length > 0 ? `${berjalan.length} pengajuan menunggu Finance · ${fmtCurrencyFull(totalMenunggu)}` : "Tidak ada pengajuan yang menunggu"}
            </div>
            <Btn variant="primary" onClick={bukaForm}>
              + Pengajuan baru
            </Btn>
          </div>

          <Card>
            <CardHeader title="Sedang diproses" subtitle="Menunggu persetujuan atau transfer Finance" />
            <CardBody className="space-y-3">
              {berjalan.length === 0 ? (
                <Empty label="Belum ada pengajuan yang diproses." />
              ) : (
                berjalan.map((p) => (
                  <KartuPengajuan
                    key={p.id}
                    p={p}
                    aksi={
                      p.status === "diajukan" && (
                        <Btn onClick={() => { setBatal(p); setAlasanBatal(""); }}>Batalkan</Btn>
                      )
                    }
                  />
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Riwayat" subtitle="Sudah ditransfer, ditolak, atau dibatalkan (100 terbaru)" />
            <CardBody className="space-y-3">
              {selesai.length === 0 ? <Empty label="Belum ada riwayat." /> : selesai.map((p) => <KartuPengajuan key={p.id} p={p} />)}
            </CardBody>
          </Card>
        </div>
      )}

      <Modal
        open={!!form}
        title="Pengajuan biaya baru"
        onClose={() => setForm(null)}
        footer={
          <>
            <Btn onClick={() => setForm(null)}>Batal</Btn>
            <Btn variant="primary" onClick={ajukan} disabled={kirim}>
              {kirim ? "Mengirim…" : "Kirim ke Finance"}
            </Btn>
          </>
        }
      >
        {form && (
          <>
            <Field label="Kategori">
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(LABEL_KATEGORI) as KategoriPengajuan[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => ubah("kategori", k)}
                    className={`text-[11px] font-semibold rounded px-3 py-1.5 border ${form.kategori === k ? "border-gold-500 text-gold-400" : "border-ink/15 text-ink/50"}`}
                  >
                    {LABEL_KATEGORI[k]}
                  </button>
                ))}
              </div>
            </Field>
            {form.kategori === "lain_lain" && (
              <Field label="Nama biaya">
                <input className={inputCls} maxLength={80} placeholder="mis. Gas elpiji, Servis AC" value={form.kategori_nama} onChange={(e) => ubah("kategori_nama", e.target.value)} />
              </Field>
            )}
            <Field label="Jenis">
              <select className={inputCls} value={form.jenis} onChange={(e) => ubah("jenis", e.target.value)}>
                {(Object.keys(LABEL_JENIS) as JenisPengajuan[]).map((j) => (
                  <option key={j} value={j}>
                    {LABEL_JENIS[j]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bulan biaya">
              <select className={inputCls} value={form.periode} onChange={(e) => ubah("periode", e.target.value)}>
                {(data?.periode_boleh ?? []).map((p) => (
                  <option key={p} value={p}>
                    {labelPeriode(p)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nominal (Rp)">
              <input className={inputCls} inputMode="numeric" placeholder="350000" value={form.nominal} onChange={(e) => ubah("nominal", e.target.value)} />
            </Field>
            <Field label="Keterangan">
              <textarea className={inputCls} rows={2} maxLength={1000} placeholder="mis. Laundry sprei & handuk 1–15 Nov" value={form.keterangan} onChange={(e) => ubah("keterangan", e.target.value)} />
            </Field>
            <Field label={form.jenis === "reimburse" ? "Rekening penggantian (rekening Anda)" : "Rekening tujuan transfer"}>
              <input className={inputCls} maxLength={120} placeholder="Nama pemilik rekening" value={form.penerima_nama} onChange={(e) => ubah("penerima_nama", e.target.value)} />
              <div className="grid grid-cols-2 gap-3 mt-2">
                <input className={inputCls} maxLength={60} placeholder="Bank (BCA, BRI…)" value={form.penerima_bank} onChange={(e) => ubah("penerima_bank", e.target.value)} />
                <input className={inputCls} maxLength={40} inputMode="numeric" placeholder="Nomor rekening" value={form.penerima_rekening} onChange={(e) => ubah("penerima_rekening", e.target.value)} />
              </div>
            </Field>
            <Field label="Lampiran">
              <div className="space-y-3">
                <PilihFile label="Foto nota / tagihan" value={nota} onChange={setNota} />
                {form.jenis === "reimburse" && <PilihFile label="Bukti bayar Anda" value={buktiBayar} onChange={setBuktiBayar} wajib />}
              </div>
            </Field>
          </>
        )}
      </Modal>

      <Modal
        open={!!batal}
        title="Batalkan pengajuan"
        onClose={() => setBatal(null)}
        footer={
          <>
            <Btn onClick={() => setBatal(null)}>Kembali</Btn>
            <Btn variant="primary" onClick={batalkan} disabled={kirim || alasanBatal.trim().length < 3}>
              Batalkan pengajuan
            </Btn>
          </>
        }
      >
        <Field label="Alasan">
          <input className={inputCls} value={alasanBatal} onChange={(e) => setAlasanBatal(e.target.value)} placeholder="mis. salah nominal, diajukan ulang" />
        </Field>
      </Modal>
    </ManagerShell>
  );
}
