"use client";

import { useMemo, useRef, useState } from "react";
import { localApi } from "@/lib/api";
import { fmtCurrencyFull, fmtDate, todayISO } from "@/lib/format";
import { Card, CardHeader, Badge } from "@/components/Card";
import { Btn } from "@/components/Modal";
import type { FinanceChecklistItem } from "@/lib/types";
import type { PayoutOtaBacaan } from "@/lib/aiBridge";
import { bacaPayoutBookingCom, cocokkanPayout, type HasilPayout, type PayoutBaris, type StatusPayout } from "@/lib/payoutOta";
import { bacaSebagaiDataUrl, kecilkanGambar, MAKS_PDF_BYTE } from "./_MutasiBank";

/**
 * Unggah daftar payout OTA (owner 2026-11-06): Booking.com dan Agoda
 * mengirim daftar payout per booking sebelum transfer. Finance cukup
 * mengunggah foto/screenshot/PDF-nya (atau CSV Booking.com); AI hanya
 * menyalin baris, pencocokan per booking dikerjakan src/lib/payoutOta.ts,
 * dan tidak ada yang tercatat sebelum finance menekan tombol. Jumlah yang
 * dicatat = Net dari OTA per booking.
 */

const LABEL: Record<StatusPayout, { teks: string; tone: "ok" | "pending" | "danger" }> = {
  cocok_nomor: { teks: "Cocok (nomor)", tone: "ok" },
  cocok_nama: { teks: "Cocok (nama+tanggal)", tone: "ok" },
  sudah_masuk: { teks: "Sudah dicentang", tone: "ok" },
  ambigu: { teks: "Lebih dari satu kandidat", tone: "pending" },
  tidak_ketemu: { teks: "Tidak ketemu", tone: "danger" },
  duplikat: { teks: "Nomor dobel", tone: "pending" },
  bukan_reservasi: { teks: "Bukan reservasi", tone: "pending" },
};

interface Bacaan {
  ota: "booking.com" | "agoda" | null;
  rows: PayoutBaris[];
  total: number | null;
  catatan: string;
  ditolak: string[];
}

export function PayoutOtaCard({
  items,
  onCatat,
}: {
  items: FinanceChecklistItem[];
  /** Mencatat baris yang cocok sebagai sudah masuk; mengembalikan pesan hasil, melempar galat kalau gagal. */
  onCatat: (rows: { booking_id: string; ota_booking_number: string; net: number }[], tanggal: string, ref: string) => Promise<string>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [bacaan, setBacaan] = useState<Bacaan | null>(null);
  const [namaFile, setNamaFile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [tanggal, setTanggal] = useState(todayISO());
  const [ref, setRef] = useState("");

  const hasil: HasilPayout[] = useMemo(() => {
    if (!bacaan) return [];
    const pola = bacaan.ota === "agoda" ? /agoda/i : bacaan.ota === "booking.com" ? /booking/i : /booking|agoda/i;
    return cocokkanPayout(bacaan.rows, items, pola);
  }, [bacaan, items]);

  const bisaDicatat = hasil.filter((h) => (h.status === "cocok_nomor" || h.status === "cocok_nama") && h.item);
  const totalCatat = bisaDicatat.reduce((a, h) => a + h.baris.net, 0);
  const totalFile = bacaan ? bacaan.rows.reduce((a, r) => a + (r.reservasi ? r.net : 0), 0) : 0;
  const totalBedah = bacaan?.total != null && bacaan.total !== totalFile;

  async function pilihFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPesan(null);
    setBacaan(null);
    setNamaFile(file.name);
    setBusy(true);
    try {
      if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
        const h = bacaPayoutBookingCom(await file.text());
        if ("galat" in h) throw new Error(h.galat);
        setBacaan({ ota: "booking.com", rows: h.rows, total: null, catatan: "", ditolak: h.ditolak });
      } else {
        let dataUrl: string;
        if (file.type === "application/pdf") {
          if (file.size > MAKS_PDF_BYTE) throw new Error("PDF terlalu besar (maks 3 MB). Kirim halaman yang perlu saja, atau screenshot.");
          dataUrl = await bacaSebagaiDataUrl(file);
        } else dataUrl = await kecilkanGambar(file);
        const h = await localApi<PayoutOtaBacaan>("/api/finance/payout-ota", { method: "POST", body: JSON.stringify({ dataUrl }) });
        if (!h.readable) throw new Error(`Daftar payout tidak terbaca${h.catatan ? `: ${h.catatan}` : "."} Coba foto yang lebih jelas.`);
        setBacaan({
          ota: h.ota,
          rows: h.rows.map((r) => ({ ...r, reservasi: r.tipe === "" || /reserv|booking/i.test(r.tipe) })),
          total: h.total,
          catatan: h.catatan,
          ditolak: [],
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function catat() {
    if (!bisaDicatat.length || busy) return;
    const ok = window.confirm(
      `Tandai ${bisaDicatat.length} booking sebagai sudah masuk (total Net ${fmtCurrencyFull(totalCatat)}) tanggal ${fmtDate(tanggal)}?\n\nLakukan ini setelah transfer benar-benar masuk di rekening.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const rows = bisaDicatat.map((h) => ({ booking_id: h.item!.booking_id, ota_booking_number: h.baris.nomor, net: h.baris.net }));
      setPesan(await onCatat(rows, tanggal, ref));
      setBacaan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title="Cocokkan dari Daftar Payout OTA"
        subtitle="Unggah foto, screenshot, atau PDF daftar payout Booking.com / Agoda (CSV Booking.com juga bisa). Dicocokkan per booking, jumlah dicatat sesuai Net dari OTA."
      />
      <div className="p-4 flex flex-wrap items-center gap-3">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.csv,text/csv" className="hidden" onChange={(e) => pilihFile(e.target.files?.[0])} />
        <Btn variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Memproses…" : "Unggah daftar payout"}
        </Btn>
        {namaFile && !busy && <span className="text-[10.5px] text-ink/40">{namaFile}</span>}
        {busy && <span className="text-[10.5px] text-ink/40">Foto biasanya 10–30 detik.</span>}
      </div>
      {error && <div className="px-4 pb-4 text-ruby-500 text-xs">{error}</div>}
      {pesan && <div className="px-4 pb-4 text-gold-600 text-xs">{pesan}</div>}

      {bacaan && (
        <>
          <div className="px-4 pb-2 text-[10.5px] text-ink/40">
            {bacaan.ota ? `${bacaan.ota} · ` : ""}
            {bacaan.rows.length} baris terbaca, total Net {fmtCurrencyFull(totalFile)}.
            {totalBedah && (
              <div className="text-ruby-400 mt-1">
                Total di dokumen {fmtCurrencyFull(bacaan.total!)} berbeda dari jumlah baris terbaca. Mungkin ada baris yang terlewat; cek dokumen asli sebelum mencatat.
              </div>
            )}
            {bacaan.catatan && <div className="text-gold-600 mt-1">Catatan pembaca: {bacaan.catatan}</div>}
            {bacaan.ditolak.length > 0 && <div className="text-gold-600 mt-1">{bacaan.ditolak.length} baris dilewati: {bacaan.ditolak.slice(0, 3).join("; ")}</div>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-ink/55 text-[9.5px] uppercase tracking-wide">
                  <th className="text-left px-4 py-2">Nomor</th>
                  <th className="text-left px-4 py-2">Tamu</th>
                  <th className="text-left px-4 py-2">Menginap</th>
                  <th className="text-right px-4 py-2">Net OTA</th>
                  <th className="text-right px-4 py-2">Seharusnya</th>
                  <th className="text-right px-4 py-2">Selisih</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {hasil.map((h, i) => (
                  <tr key={i} className="border-t border-ink/[0.05] text-ink/70 align-top">
                    <td className="px-4 py-2 whitespace-nowrap">{h.baris.nomor}</td>
                    <td className="px-4 py-2">
                      {h.baris.tamu || "—"}
                      {h.item && h.item.guest_nama !== h.baris.tamu && <div className="text-ink/55 text-[10px]">di sistem: {h.item.guest_nama}</div>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{h.baris.checkin ? `${fmtDate(h.baris.checkin)} – ${fmtDate(h.baris.checkout)}` : "—"}</td>
                    <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{fmtCurrencyFull(h.baris.net)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{h.item ? fmtCurrencyFull(h.item.seharusnya) : "—"}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{h.selisih == null ? "—" : fmtCurrencyFull(h.selisih)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Badge tone={LABEL[h.status].tone}>{LABEL[h.status].teks}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 flex flex-wrap items-end gap-3 border-t border-ink/[0.05]">
            <label className="text-[10.5px] text-ink/50">
              Tanggal dana masuk
              <input type="date" value={tanggal} max={todayISO()} onChange={(e) => setTanggal(e.target.value)} className="block mt-1 border border-ink/10 rounded px-2 py-1 text-xs" />
            </label>
            <label className="text-[10.5px] text-ink/50">
              Referensi bank (opsional)
              <input value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} className="block mt-1 border border-ink/10 rounded px-2 py-1 text-xs w-56" />
            </label>
            <Btn variant="primary" disabled={busy || !bisaDicatat.length || !tanggal} onClick={catat}>
              {bisaDicatat.length ? `Tandai ${bisaDicatat.length} booking sudah masuk (${fmtCurrencyFull(totalCatat)})` : "Tidak ada baris yang bisa dicatat"}
            </Btn>
          </div>
          <div className="px-4 pb-3 text-[10.5px] text-ink/55">
            Hanya baris berstatus Cocok yang dicatat. Baris lain dicek manual di tabel centang di bawah. Pastikan transfer sudah masuk di rekening sebelum menekan tombol. Nomor booking OTA disimpan supaya pencocokan berikutnya lewat nomor.
          </div>
        </>
      )}
    </Card>
  );
}
