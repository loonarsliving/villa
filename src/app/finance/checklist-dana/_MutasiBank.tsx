"use client";

import { useMemo, useRef, useState } from "react";
import { localApi } from "@/lib/api";
import { fmtCurrencyFull, fmtDate } from "@/lib/format";
import { Card, CardHeader, Badge } from "@/components/Card";
import { Btn } from "@/components/Modal";
import type { PencairanGroup } from "@/lib/financePencairan";
import { cocokkanMutasi, type HasilCocok, type MutasiBaris } from "@/lib/mutasiBank";

/**
 * Unggah mutasi bank (owner 2026-10-29): foto, screenshot aplikasi bank, atau
 * PDF rekening koran. AI menyalin barisnya, halaman ini mengusulkan
 * pencairan yang cocok (src/lib/mutasiBank.ts), dan finance menekan "Pakai"
 * untuk mengisi pilihan + nilai mutasi di kartu centang yang sudah ada.
 * Tidak ada yang tercatat sebelum finance menekan "Tandai masuk" di sana.
 */

interface Bacaan {
  readable: boolean;
  bank: string | null;
  rows: MutasiBaris[];
  catatan: string;
}

/** Mutasi berisi teks kecil: lebih besar dari foto chat (1600px), tetap di bawah batas body server. */
const SISI_MAKS_GAMBAR = 2400;
const MAKS_PDF_BYTE = 3_000_000;

function kecilkanGambar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const skala = Math.min(1, SISI_MAKS_GAMBAR / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * skala));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * skala));
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Browser tidak bisa memproses gambar"));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("File ini bukan gambar yang bisa dibuka"));
    };
    img.src = url;
  });
}

function bacaSebagaiDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("File tidak bisa dibaca"));
    r.readAsDataURL(file);
  });
}

function labelStatus(h: HasilCocok) {
  if (h.status === "cocok") return <Badge tone="ok">Cocok</Badge>;
  if (h.status === "selisih") return <Badge tone="pending">Ada selisih</Badge>;
  if (h.status === "sudah_tercatat") return <Badge tone="ok">Sudah dicentang</Badge>;
  return <Badge tone="danger">Tidak ketemu</Badge>;
}

export function MutasiBankCard({
  groups,
  bulanLabel,
  onPakai,
}: {
  groups: PencairanGroup[];
  bulanLabel: string;
  onPakai: (g: PencairanGroup, baris: MutasiBaris) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [bacaan, setBacaan] = useState<Bacaan | null>(null);
  const [namaFile, setNamaFile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasil = useMemo(() => (bacaan ? cocokkanMutasi(bacaan.rows, groups) : []), [bacaan, groups]);
  const jumlahKeluar = bacaan ? bacaan.rows.filter((r) => r.arah === "keluar").length : 0;

  async function pilihFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBacaan(null);
    setNamaFile(file.name);
    setBusy(true);
    try {
      let dataUrl: string;
      if (file.type === "application/pdf") {
        if (file.size > MAKS_PDF_BYTE) throw new Error("PDF terlalu besar (maks 3 MB). Kirim halaman yang perlu saja, atau screenshot.");
        dataUrl = await bacaSebagaiDataUrl(file);
      } else {
        dataUrl = await kecilkanGambar(file);
      }
      setBacaan(await localApi<Bacaan>("/api/finance/mutasi-bank", { method: "POST", body: JSON.stringify({ dataUrl }) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title="Cocokkan dari Mutasi Bank"
        subtitle="Unggah foto, screenshot, atau PDF mutasi rekening. Sistem membaca uang masuk dan mengusulkan pencairan OTA yang cocok."
      />
      <div className="p-4 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => pilihFile(e.target.files?.[0])}
        />
        <Btn variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Membaca mutasi…" : "Unggah mutasi"}
        </Btn>
        {namaFile && !busy && <span className="text-[10.5px] text-ink/40">{namaFile}</span>}
        {busy && <span className="text-[10.5px] text-ink/40">Biasanya 10–30 detik.</span>}
      </div>
      {error && <div className="px-4 pb-4 text-ruby-500 text-xs">{error}</div>}

      {bacaan && !bacaan.readable && (
        <div className="px-4 pb-4 text-ruby-400 text-[11px]">
          Mutasi tidak terbaca{bacaan.catatan ? `: ${bacaan.catatan}` : "."} Coba foto yang lebih jelas atau screenshot langsung dari aplikasi bank.
        </div>
      )}

      {bacaan?.readable && (
        <>
          <div className="px-4 pb-2 text-[10.5px] text-ink/40">
            {bacaan.bank ? `${bacaan.bank} · ` : ""}
            {hasil.length} uang masuk terbaca{jumlahKeluar ? `, ${jumlahKeluar} uang keluar diabaikan` : ""}. Cocokkan nominalnya dengan dokumen asli
            sebelum menekan Pakai.
            {bacaan.catatan && <div className="text-gold-600 mt-1">Catatan pembaca: {bacaan.catatan}</div>}
          </div>
          {hasil.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-ink/35 text-[9.5px] uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Tanggal</th>
                    <th className="text-left px-4 py-2">Keterangan</th>
                    <th className="text-right px-4 py-2">Nominal</th>
                    <th className="text-left px-4 py-2">Pencairan</th>
                    <th className="text-right px-4 py-2">Selisih</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {hasil.map((h, i) => (
                    <tr key={i} className="border-t border-ink/[0.05] text-ink/70 align-top">
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDate(h.baris.tanggal)}</td>
                      <td className="px-4 py-2 max-w-[260px] break-words">{h.baris.keterangan || "—"}</td>
                      <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{fmtCurrencyFull(h.baris.nominal)}</td>
                      <td className="px-4 py-2">
                        {h.group ? (
                          <>
                            {h.group.sumber} · {fmtDate(h.group.tanggal, { weekday: "short", day: "2-digit", month: "short" })}
                            <div className="text-ink/35 text-[10px]">
                              {h.status === "sudah_tercatat"
                                ? `${h.group.count} booking, sudah dicentang semua`
                                : `${h.group.count_belum} booking belum masuk · ${fmtCurrencyFull(h.group.belum)}`}
                            </div>
                          </>
                        ) : (
                          <span className="text-ink/35 text-[10.5px]">
                            {h.sumber ? `Tidak ada pencairan ${h.sumber} yang mirip di ${bulanLabel}` : "Bukan transfer OTA yang dikenali"}
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-2 text-right whitespace-nowrap ${h.selisih && h.status === "selisih" ? "text-ruby-400" : ""}`}>
                        {h.selisih == null ? "—" : fmtCurrencyFull(h.selisih)}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {labelStatus(h)}
                          {h.group && h.status !== "sudah_tercatat" && (
                            <button className="text-[10px] text-gold-400 underline" onClick={() => onPakai(h.group!, h.baris)}>
                              Pakai
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 py-3 text-[10.5px] text-ink/35 border-t border-ink/[0.05]">
            Pakai = memilih semua booking pencairan itu dan mengisi nilai, tanggal, dan keterangan mutasi di kartu di bawah. Nilai mutasi dibagi ke
            booking sebanding angka seharusnya, dan selisihnya tercatat. Pencairan dicari di bulan {bulanLabel}; kalau transfer jatuh di bulan lain,
            ganti bulan di atas. File mutasi tidak disimpan.
          </div>
        </>
      )}
    </Card>
  );
}
