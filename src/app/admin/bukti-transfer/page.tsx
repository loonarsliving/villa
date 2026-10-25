"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { localApi } from "@/lib/api";
import { fmtCurrencyFull, fmtDateTime } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Loading } from "@/components/Card";

/**
 * Mesin bukti transfer dividen (owner 2026-10-25). Setelah transfer di
 * bank, owner mencentang investor yang sudah ditransfer lalu menekan kirim;
 * mesin membuat bukti versi Loonars per investor dan mengirimnya lewat WA
 * nomor utama. Lihat src/lib/buktiTransfer.ts.
 */

interface Penerima {
  kunci: string;
  nama: string;
  bank: string | null;
  rek4: string | null;
  units: string[];
  jumlah: number;
  pemasukan_tetap: boolean;
  rekening_lengkap: boolean;
  sudah_dikirim_at: string | null;
  pratinjau: string;
}

interface Daftar {
  periode: string;
  tanggal: string;
  per_unit: number;
  ringkasan: { pendapatan: number; opex_total: number; opex_pct: number; kelebihan_opex: number };
  penerima: Penerima[];
}

interface HasilKirim {
  hasil: { kunci: string; nama: string; ok: boolean; error?: string }[];
  terkirim: number;
  gagal: number;
  dilewati_sudah_terkirim: number;
}

export default function BuktiTransferPage() {
  const [daftar, setDaftar] = useState<Daftar | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [mengirim, setMengirim] = useState(false);
  const [hasil, setHasil] = useState<HasilKirim | null>(null);

  const muat = useCallback(() => {
    setGalat(null);
    localApi<Daftar>("/api/admin/bukti-transfer")
      .then((d) => {
        setDaftar(d);
        setPilih(new Set(d.penerima.filter((p) => !p.sudah_dikirim_at && p.rekening_lengkap).map((p) => p.kunci)));
      })
      .catch((e: Error) => setGalat(e.message));
  }, []);

  useEffect(muat, [muat]);

  function ubah(kunci: string) {
    setPilih((s) => {
      const n = new Set(s);
      if (n.has(kunci)) n.delete(kunci);
      else n.add(kunci);
      return n;
    });
  }

  const terpilih = daftar?.penerima.filter((p) => pilih.has(p.kunci)) ?? [];
  const total = terpilih.reduce((s, p) => s + p.jumlah, 0);
  const adaUlang = terpilih.some((p) => p.sudah_dikirim_at);

  async function kirim() {
    if (!terpilih.length) return;
    const ok = window.confirm(
      `Kirim bukti transfer ke ${terpilih.length} investor (total ${fmtCurrencyFull(total)})?\n\nPastikan semuanya SUDAH ditransfer di bank.` +
        (adaUlang ? "\n\nSebagian sudah pernah dikirimi bukti bulan ini dan akan dikirimi lagi." : ""),
    );
    if (!ok) return;
    setMengirim(true);
    setHasil(null);
    try {
      const r = await localApi<HasilKirim>("/api/admin/bukti-transfer", {
        method: "POST",
        body: JSON.stringify({ kunci: [...pilih], ulang: adaUlang }),
      });
      setHasil(r);
      muat();
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    } finally {
      setMengirim(false);
    }
  }

  return (
    <AdminShell pageTitle="Bukti Transfer Dividen" pageSub="Centang investor yang sudah ditransfer, mesin mengirim buktinya lewat WA">
      {galat && <div className="mb-4 rounded-lg border border-ruby-500/30 bg-ruby-500/10 px-3 py-2.5 text-[11.5px] text-ruby-400">{galat}</div>}
      {hasil && (
        <div className="mb-4 rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-2.5 text-[11.5px] text-gold-500">
          {hasil.terkirim} bukti terkirim{hasil.gagal ? `, ${hasil.gagal} gagal` : ""}
          {hasil.dilewati_sudah_terkirim ? `, ${hasil.dilewati_sudah_terkirim} dilewati (sudah pernah dikirim)` : ""}.
          {hasil.hasil
            .filter((h) => !h.ok)
            .map((h) => (
              <div key={h.kunci} className="mt-1 text-ruby-400">
                {h.nama}: {h.error}
              </div>
            ))}
        </div>
      )}
      {!daftar ? (
        !galat && <Loading />
      ) : (
        <Card>
          <CardHeader
            title={`Periode ${daftar.periode}`}
            subtitle={`Per unit ${fmtCurrencyFull(daftar.per_unit)} · pendapatan villa ${fmtCurrencyFull(daftar.ringkasan.pendapatan)} · OPEX ${daftar.ringkasan.opex_pct}%`}
          />
          {daftar.penerima.map((p) => (
            <label key={p.kunci} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 cursor-pointer">
              <input type="checkbox" checked={pilih.has(p.kunci)} onChange={() => ubah(p.kunci)} className="accent-gold-500 w-4 h-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink/85 font-medium truncate">
                  {p.units.length ? `${p.units.join(" & ")} — ` : ""}
                  {p.nama}
                </div>
                <div className="text-[10.5px] text-ink/40 truncate">
                  {p.rekening_lengkap ? `${p.bank} •••• ${p.rek4}` : "Rekening belum diisi"}
                  {p.sudah_dikirim_at ? ` · bukti terkirim ${fmtDateTime(p.sudah_dikirim_at)}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12.5px] text-ink/85 font-semibold">{fmtCurrencyFull(p.jumlah)}</div>
                <div className="mt-0.5 flex items-center justify-end gap-2">
                  {p.sudah_dikirim_at && <Badge tone="ok">TERKIRIM</Badge>}
                  {p.pemasukan_tetap && <Badge tone="pending">TETAP</Badge>}
                  <a href={p.pratinjau} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10px] text-gold-400 underline">
                    Lihat bukti
                  </a>
                </div>
              </div>
            </label>
          ))}
          <CardBody>
            <button
              onClick={() => void kirim()}
              disabled={mengirim || !terpilih.length}
              className="w-full bg-gold-500 text-base-950 rounded-lg py-3 text-[12.5px] font-semibold tracking-wide hover:opacity-90 active:scale-[0.99] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mengirim ? "Mengirim…" : `Sudah transfer — kirim bukti ke ${terpilih.length} investor (${fmtCurrencyFull(total)})`}
            </button>
          </CardBody>
        </Card>
      )}
    </AdminShell>
  );
}
