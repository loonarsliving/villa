"use client";

import { useEffect, useMemo, useState } from "react";
import { api, localApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, todayISO } from "@/lib/format";
import { addDaysISO } from "@/lib/stayDates";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { Unit } from "@/lib/types";

const SUMBER = ["walk-in", "whatsapp", "website", "airbnb", "agoda", "booking.com", "tiket", "traveloka", "google", "other"];

/**
 * Booking walk-in Loonars Excellent Living di halaman Booking bersama
 * (multi-properti 2026-11-04). Private Living membuat booking walk-in lewat
 * kasir QRIS; EL belum punya QRIS, jadi booking dicatat di sini dengan Total
 * Bayar terisi otomatis dari harga Cloudbeds EL (/api/el/harga, bisa
 * diubah). villa-api menandai booking ini "[Front Desk EL]" dan sinkron EL
 * mengirimnya ke Cloudbeds supaya kamarnya tertutup di OTA.
 */
export function BookingBaruEl({ units, onSelesai }: { units: Unit[]; onSelesai: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ unit_id: "", guest_nama: "", guest_hp: "", sumber: "walk-in", tgl_checkin: todayISO(), tgl_checkout: addDaysISO(todayISO(), 1), total: "" });
  const [harga, setHarga] = useState<{ tipeKamar: Record<string, string>; tipe: { room_type_id: string; total: number | null }[] } | null>(null);
  const [hargaErr, setHargaErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const tanggalValid = f.tgl_checkout > f.tgl_checkin;

  useEffect(() => {
    if (!open || !tanggalValid) return;
    let batal = false;
    setHargaErr(null);
    localApi<{ tipeKamar: Record<string, string>; tipe: { room_type_id: string; total: number | null }[] }>(`/api/el/harga?${new URLSearchParams({ checkin: f.tgl_checkin, checkout: f.tgl_checkout })}`)
      .then((h) => !batal && setHarga(h))
      .catch((e) => !batal && (setHarga(null), setHargaErr(e instanceof Error ? e.message : String(e))));
    return () => {
      batal = true;
    };
  }, [open, tanggalValid, f.tgl_checkin, f.tgl_checkout]);

  const hargaKamar = useMemo(() => {
    if (!harga || !f.unit_id) return undefined;
    return harga.tipe.find((t) => t.room_type_id === harga.tipeKamar[f.unit_id])?.total ?? null;
  }, [harga, f.unit_id]);

  useEffect(() => {
    if (!manual && hargaKamar != null) setF((x) => ({ ...x, total: String(hargaKamar) }));
  }, [hargaKamar, manual]);

  async function simpan() {
    const unit = units.find((u) => u.id === f.unit_id);
    if (!unit || !f.guest_nama.trim() || !tanggalValid || !(Number(f.total) > 0)) {
      toast("⚠", "Lengkapi form", "Kamar, nama tamu, tanggal, dan total bayar wajib diisi.", "ruby");
      return;
    }
    setBusy(true);
    try {
      const malam = Math.round((Date.parse(f.tgl_checkout) - Date.parse(f.tgl_checkin)) / 86400000);
      await api.post("/bookings", {
        unit_id: unit.id,
        unit_nomor: unit.nomor,
        tipe: "harian",
        sumber: f.sumber,
        tgl_checkin: f.tgl_checkin,
        tgl_checkout: f.tgl_checkout,
        durasi_malam: malam,
        guest_nama: f.guest_nama.trim(),
        guest_hp: f.guest_hp.trim() || null,
        total_bayar: Number(f.total),
      });
      toast("✓", "Booking dibuat", `${f.guest_nama} — Kamar ${unit.nomor}. Dikirim ke Cloudbeds dalam 10 menit.`, "sage");
      setOpen(false);
      setManual(false);
      setF((x) => ({ ...x, unit_id: "", guest_nama: "", guest_hp: "", total: "" }));
      onSelesai();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>+ Booking</Btn>
      <Modal
        open={open}
        title="Booking Baru — Excellent Living"
        onClose={() => setOpen(false)}
        footer={<><Btn onClick={() => setOpen(false)}>Batal</Btn><Btn variant="primary" disabled={busy} onClick={simpan}>{busy ? "Menyimpan..." : "Simpan"}</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Check-in"><input type="date" className={inputCls} value={f.tgl_checkin} onChange={(e) => setF({ ...f, tgl_checkin: e.target.value })} /></Field>
          <Field label="Check-out"><input type="date" className={inputCls} value={f.tgl_checkout} onChange={(e) => setF({ ...f, tgl_checkout: e.target.value })} /></Field>
        </div>
        <Field label="Kamar">
          <select className={inputCls} value={f.unit_id} onChange={(e) => setF({ ...f, unit_id: e.target.value })}>
            <option value="">Pilih kamar</option>
            {units.map((u) => (
              <option key={u.id} value={u.id} disabled={u.status === "maintenance"}>
                {u.nomor}{u.status === "maintenance" ? " — ditutup" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nama tamu"><input className={inputCls} value={f.guest_nama} onChange={(e) => setF({ ...f, guest_nama: e.target.value })} /></Field>
        <Field label="No. WhatsApp (opsional)"><input className={inputCls} value={f.guest_hp} onChange={(e) => setF({ ...f, guest_hp: e.target.value })} /></Field>
        <Field label="Sumber">
          <select className={inputCls} value={f.sumber} onChange={(e) => setF({ ...f, sumber: e.target.value })}>
            {SUMBER.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Total Bayar (Rp)">
          <input type="number" min={0} className={inputCls} value={f.total} onChange={(e) => { setManual(true); setF({ ...f, total: e.target.value }); }} />
          <div className="mt-1 text-[11px] text-ink/50">
            {hargaErr
              ? `Harga Cloudbeds tidak terbaca: ${hargaErr}`
              : !f.unit_id
                ? "Pilih kamar untuk melihat harga Cloudbeds."
                : hargaKamar === undefined
                  ? "Memuat harga Cloudbeds..."
                  : hargaKamar === null
                    ? "Harga Cloudbeds belum diatur untuk semua malam ini — isi manual."
                    : `Harga Cloudbeds: ${fmtCurrencyFull(hargaKamar)}`}
          </div>
        </Field>
        <div className="text-[11px] text-ink/40">Kamar yang ditutup (maintenance) tidak bisa dipilih; dibuka oleh manager di menu Kamar Excellent Living.</div>
      </Modal>
    </>
  );
}
