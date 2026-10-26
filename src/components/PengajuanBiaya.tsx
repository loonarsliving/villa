"use client";

import { useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/Card";
import { fmtCurrencyFull, fmtDate, fmtDateTime } from "@/lib/format";
import { dataUrlByteSize, shrinkImageForUpload, UPLOAD_MAX_DATA_URL_BYTES } from "@/lib/imageResize";
import {
  kodePengajuan,
  LABEL_JENIS,
  LABEL_STATUS,
  labelPeriode,
  namaBiaya,
  NADA_STATUS,
  type PengajuanBiaya,
} from "@/lib/pengajuanBiaya";

function bacaDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("Gagal membaca file"));
    r.readAsDataURL(file);
  });
}

/** Foto diperkecil (sisi terpanjang 1600px); PDF dikirim apa adanya. Maks 3MB. */
async function fileKeDataUrl(file: File): Promise<string> {
  const dataUrl = file.type === "application/pdf" ? await bacaDataUrl(file) : await shrinkImageForUpload(file);
  if (dataUrlByteSize(dataUrl) > UPLOAD_MAX_DATA_URL_BYTES) throw new Error("File terlalu besar (maks 3MB)");
  return dataUrl;
}

/** Tombol pilih foto/PDF; `onChange` menerima data URL siap kirim (atau null saat dihapus). */
export function PilihFile({
  label,
  value,
  onChange,
  wajib,
}: {
  label: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  wajib?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [nama, setNama] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [proses, setProses] = useState(false);

  async function pilih(file: File | undefined) {
    if (!file) return;
    setProses(true);
    setGalat(null);
    try {
      onChange(await fileKeDataUrl(file));
      setNama(file.name);
    } catch (e) {
      onChange(null);
      setNama(null);
      setGalat(e instanceof Error ? e.message : "Gagal membaca file");
    } finally {
      setProses(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={proses}
          className="text-[11px] font-semibold border border-ink/15 rounded px-3 py-2 text-ink/70 bg-base-800"
        >
          {proses ? "Memproses…" : value ? "Ganti file" : `📎 ${label}${wajib ? " *" : ""}`}
        </button>
        {value && (
          <>
            <span className="text-[11px] text-ink/60 truncate max-w-[180px]">{nama ?? "File terpilih"}</span>
            <button type="button" onClick={() => { onChange(null); setNama(null); }} className="text-[10px] text-ruby-400">
              Hapus
            </button>
          </>
        )}
      </div>
      {value?.startsWith("data:image/") && <img src={value} alt="" className="mt-2 max-h-40 rounded border border-ink/10" />}
      {galat && <div className="text-ruby-500 text-[11px] mt-1">{galat}</div>}
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => pilih(e.target.files?.[0])}
      />
    </div>
  );
}

function TautanFile({ url, label }: { url: string | null; label: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-gold-400 underline underline-offset-2">
      {label}
    </a>
  );
}

/** Satu pengajuan: ringkasan, rekening tujuan, file, riwayat status, dan tombol aksi (opsional). */
export function KartuPengajuan({ p, aksi }: { p: PengajuanBiaya; aksi?: ReactNode }) {
  const [buka, setBuka] = useState(false);
  return (
    <div className="border border-ink/[0.08] rounded-xl p-3.5 bg-base-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] text-ink/40 font-mono">
            {kodePengajuan(p.nomor)} · {labelPeriode(p.periode)} · lewat {p.diajukan_lewat === "chat" ? "chat" : "dashboard"}
          </div>
          <div className="text-[13px] font-semibold text-ink/90 mt-0.5">{namaBiaya(p)}</div>
          <div className="text-[11px] text-ink/50">{LABEL_JENIS[p.jenis]} · oleh {p.diajukan_oleh_nama}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[14px] font-semibold text-ink">{fmtCurrencyFull(p.nominal)}</div>
          <Badge tone={NADA_STATUS[p.status]}>{LABEL_STATUS[p.status]}</Badge>
        </div>
      </div>

      <p className="text-[12px] text-ink/70 mt-2 whitespace-pre-wrap break-words">{p.keterangan}</p>

      {p.penerima_rekening && (
        <div className="text-[11px] text-ink/60 mt-1.5">
          Transfer ke: <span className="font-medium text-ink/80">{p.penerima_bank} {p.penerima_rekening}</span> a.n {p.penerima_nama}
        </div>
      )}

      {p.status === "ditolak" && p.alasan_tolak && <div className="text-[11px] text-ruby-400 mt-1.5">Alasan ditolak: {p.alasan_tolak}</div>}
      {p.status === "dibatalkan" && p.alasan_batal && <div className="text-[11px] text-ruby-400 mt-1.5">Dibatalkan: {p.alasan_batal}</div>}
      {p.catatan_finance && <div className="text-[11px] text-ink/60 mt-1.5">Catatan Finance: {p.catatan_finance}</div>}
      {p.status === "ditransfer" && (
        <div className="text-[11px] text-sage-400 mt-1.5">
          Ditransfer {fmtDate(p.tanggal_transfer)} oleh {p.ditransfer_oleh_nama}
        </div>
      )}

      <div className="flex gap-3 flex-wrap mt-2">
        <TautanFile url={p.nota_url} label="Nota / tagihan" />
        <TautanFile url={p.bukti_bayar_url} label="Bukti bayar (reimburse)" />
        <TautanFile url={p.bukti_transfer_url} label="Bukti transfer Finance" />
        {p.riwayat.length > 0 && (
          <button type="button" onClick={() => setBuka(!buka)} className="text-[11px] text-ink/40 underline underline-offset-2">
            {buka ? "Tutup riwayat" : "Riwayat"}
          </button>
        )}
      </div>

      {buka && (
        <ol className="mt-2 border-l border-ink/10 pl-3 space-y-1">
          {p.riwayat.map((r, i) => (
            <li key={i} className="text-[10.5px] text-ink/50">
              {fmtDateTime(r.created_at)} — {LABEL_STATUS[r.status]}
              {r.oleh_nama ? ` · ${r.oleh_nama}` : ""}
              {r.catatan ? ` · ${r.catatan}` : ""}
            </li>
          ))}
        </ol>
      )}

      {aksi && <div className="flex gap-2 flex-wrap mt-3">{aksi}</div>}
    </div>
  );
}
