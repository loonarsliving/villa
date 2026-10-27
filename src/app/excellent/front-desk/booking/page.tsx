"use client";

import { useEffect, useState } from "react";
import { ExcellentShell } from "../../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { ElBooking, ElBookingStatus, ElRoom } from "@/lib/types";

const SUMBER = ["walk-in", "whatsapp", "website", "cloudbeds", "airbnb", "agoda", "booking.com", "tiket", "traveloka", "google", "other"];

const STATUS_LABEL: Record<ElBookingStatus, string> = {
  terjadwal: "Terjadwal",
  checkin: "Check-in",
  checkout: "Selesai",
  batal: "Batal",
};
const STATUS_TONE: Record<ElBookingStatus, "ok" | "pending" | "danger"> = {
  terjadwal: "pending",
  checkin: "ok",
  checkout: "ok",
  batal: "danger",
};

function besok(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return todayISO(d);
}

const FORM_KOSONG = { room_id: "", guest_nama: "", guest_hp: "", sumber: "walk-in", tgl_checkin: "", tgl_checkout: "", adults: 2, children: 0, total_bayar: "", catatan: "" };

export default function ElBookingPage() {
  const toast = useToast();
  const [bookings, setBookings] = useState<ElBooking[] | null>(null);
  const [rooms, setRooms] = useState<ElRoom[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(FORM_KOSONG);

  function load() {
    api.get<ElBooking[]>("/el/bookings").then(setBookings).catch(() => setBookings([]));
  }
  useEffect(() => {
    load();
    api.get<ElRoom[]>("/el/rooms").then((r) => setRooms(r.filter((x) => x.active))).catch(() => setRooms([]));
  }, []);

  function gagal(e: unknown) {
    toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
  }

  async function simpan() {
    if (!form.room_id || !form.guest_nama.trim() || !form.tgl_checkin || !form.tgl_checkout) {
      toast("⚠", "Lengkapi form", "Kamar, nama tamu, dan tanggal wajib diisi.", "ruby");
      return;
    }
    setBusy(true);
    try {
      await api.post("/el/bookings", { ...form, total_bayar: Number(form.total_bayar || 0) });
      toast("✓", "Booking dibuat", form.guest_nama, "sage");
      setOpen(false);
      setForm(FORM_KOSONG);
      load();
    } catch (e) {
      gagal(e);
    } finally {
      setBusy(false);
    }
  }

  async function aksi(b: ElBooking, action: "checkin" | "checkout" | "batal") {
    if (action === "batal" && !confirm(`Batalkan booking ${b.guest_nama}?`)) return;
    setBusy(true);
    try {
      await api.patch("/el/bookings", { id: b.id, action });
      toast("✓", "Tersimpan", `${b.guest_nama} — ${action === "checkin" ? "check-in" : action === "checkout" ? "check-out" : "dibatalkan"}`, "sage");
      load();
    } catch (e) {
      gagal(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ExcellentShell pageTitle="Booking" pageSub="Loonars Excellent Living">
      <Card>
        <CardHeader
          title="Daftar Booking"
          subtitle="Mulai 7 hari terakhir"
          action={<Btn variant="primary" onClick={() => { setForm({ ...FORM_KOSONG, tgl_checkin: todayISO(), tgl_checkout: besok() }); setOpen(true); }}>+ Booking</Btn>}
        />
        {!bookings ? (
          <Loading />
        ) : bookings.length === 0 ? (
          <Empty label="Belum ada booking" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[9.5px] uppercase tracking-wider text-ink/30">
                  <th className="px-3.5 py-2.5">Kamar</th>
                  <th className="px-3.5 py-2.5">Tamu</th>
                  <th className="px-3.5 py-2.5">Tanggal</th>
                  <th className="px-3.5 py-2.5">Sumber</th>
                  <th className="px-3.5 py-2.5 text-right">Total</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-t border-ink/[0.05]">
                    <td className="px-3.5 py-2.5 font-semibold text-ink">{b.room_nomor ?? "—"}</td>
                    <td className="px-3.5 py-2.5 text-ink/70">
                      {b.guest_nama}
                      {b.guest_hp && <div className="text-[10.5px] text-ink/35">{b.guest_hp}</div>}
                    </td>
                    <td className="px-3.5 py-2.5 text-ink/60 whitespace-nowrap">
                      {b.tgl_checkin} → {b.tgl_checkout}
                      <div className="text-[10.5px] text-ink/35">{b.durasi_malam ?? "-"} malam</div>
                    </td>
                    <td className="px-3.5 py-2.5 text-ink/60">{b.sumber}</td>
                    <td className="px-3.5 py-2.5 text-right text-ink/70 whitespace-nowrap">{fmtCurrencyFull(b.total_bayar)}</td>
                    <td className="px-3.5 py-2.5"><Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge></td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap text-right">
                      {b.status === "terjadwal" && (
                        <span className="inline-flex gap-2">
                          <Btn variant="primary" disabled={busy} onClick={() => aksi(b, "checkin")}>Check-in</Btn>
                          <Btn disabled={busy} onClick={() => aksi(b, "batal")}>Batal</Btn>
                        </span>
                      )}
                      {b.status === "checkin" && <Btn variant="primary" disabled={busy} onClick={() => aksi(b, "checkout")}>Check-out</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        title="Booking Baru"
        onClose={() => setOpen(false)}
        footer={<><Btn onClick={() => setOpen(false)}>Batal</Btn><Btn variant="primary" disabled={busy} onClick={simpan}>Simpan</Btn></>}
      >
        <Field label="Kamar">
          <select className={inputCls} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
            <option value="">Pilih kamar</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.nomor} — {r.el_room_types?.nama ?? ""}</option>
            ))}
          </select>
        </Field>
        <Field label="Nama Tamu"><input className={inputCls} value={form.guest_nama} onChange={(e) => setForm({ ...form, guest_nama: e.target.value })} /></Field>
        <Field label="No. HP (opsional)"><input className={inputCls} value={form.guest_hp} onChange={(e) => setForm({ ...form, guest_hp: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Check-in"><input type="date" className={inputCls} value={form.tgl_checkin} onChange={(e) => setForm({ ...form, tgl_checkin: e.target.value })} /></Field>
          <Field label="Check-out"><input type="date" className={inputCls} value={form.tgl_checkout} onChange={(e) => setForm({ ...form, tgl_checkout: e.target.value })} /></Field>
          <Field label="Dewasa"><input type="number" min={1} className={inputCls} value={form.adults} onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })} /></Field>
          <Field label="Anak"><input type="number" min={0} className={inputCls} value={form.children} onChange={(e) => setForm({ ...form, children: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Sumber">
          <select className={inputCls} value={form.sumber} onChange={(e) => setForm({ ...form, sumber: e.target.value })}>
            {SUMBER.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Total Bayar (Rp)"><input type="number" min={0} className={inputCls} value={form.total_bayar} onChange={(e) => setForm({ ...form, total_bayar: e.target.value })} /></Field>
        <Field label="Catatan (opsional)"><input className={inputCls} value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} /></Field>
      </Modal>
    </ExcellentShell>
  );
}
