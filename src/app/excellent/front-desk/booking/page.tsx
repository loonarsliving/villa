"use client";

import { useEffect, useMemo, useState } from "react";
import { ExcellentShell } from "../../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { CheckinCard, HOUSE_RULES_EXCELLENT_LIVING, type CheckinCardResult } from "@/components/CheckinCard";
import type { ElBooking, ElBookingStatus, ElRoomTersedia } from "@/lib/types";

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

const KONDISI = ["Baik — tidak ada kerusakan", "Ada kerusakan minor", "Ada kerusakan signifikan"];

function besok(dari?: string): string {
  const d = dari ? new Date(`${dari}T00:00:00`) : new Date();
  d.setDate(d.getDate() + 1);
  return todayISO(d);
}

const FORM_KOSONG = { room_id: "", guest_nama: "", guest_hp: "", sumber: "walk-in", tgl_checkin: "", tgl_checkout: "", adults: 2, children: 0, total_bayar: "", catatan: "" };
type FormBooking = typeof FORM_KOSONG;

export default function ElBookingPage() {
  const toast = useToast();
  const [bookings, setBookings] = useState<ElBooking[] | null>(null);
  const [filter, setFilter] = useState<"aktif" | "semua">("aktif");
  const [cari, setCari] = useState("");
  const [busy, setBusy] = useState(false);

  // Form booking baru / ubah. `editing` null = booking baru.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ElBooking | null>(null);
  const [form, setForm] = useState<FormBooking>(FORM_KOSONG);
  const [kamar, setKamar] = useState<ElRoomTersedia[] | null>(null);

  const [checkinFor, setCheckinFor] = useState<ElBooking | null>(null);
  const [checkoutFor, setCheckoutFor] = useState<ElBooking | null>(null);
  const [kondisi, setKondisi] = useState(KONDISI[0]);
  const [catatanKondisi, setCatatanKondisi] = useState("");

  function load() {
    api.get<ElBooking[]>("/el/bookings").then(setBookings).catch(() => setBookings([]));
  }
  useEffect(load, []);

  // Daftar kamar mengikuti tanggal: kamar yang sudah dipesan di rentang itu
  // tampil tapi tidak bisa dipilih, supaya resepsionis tidak kena bentrok.
  const tanggalValid = !!form.tgl_checkin && !!form.tgl_checkout && form.tgl_checkout > form.tgl_checkin;
  useEffect(() => {
    if (!open || !tanggalValid) {
      setKamar(null);
      return;
    }
    let batal = false;
    const params = new URLSearchParams({ checkin: form.tgl_checkin, checkout: form.tgl_checkout });
    if (editing) params.set("kecuali", editing.id);
    api
      .get<ElRoomTersedia[]>(`/el/rooms/tersedia?${params}`)
      .then((r) => {
        if (!batal) setKamar(r);
      })
      .catch(() => {
        if (!batal) setKamar([]);
      });
    return () => {
      batal = true;
    };
  }, [open, tanggalValid, form.tgl_checkin, form.tgl_checkout, editing]);

  const kamarPerTipe = useMemo(() => {
    const m = new Map<string, ElRoomTersedia[]>();
    for (const r of kamar ?? []) {
      const t = r.el_room_types?.nama ?? "Lainnya";
      m.set(t, [...(m.get(t) ?? []), r]);
    }
    return [...m.entries()];
  }, [kamar]);
  const jumlahKosong = (kamar ?? []).filter((r) => r.tersedia).length;
  const kamarTerpilih = (kamar ?? []).find((r) => r.id === form.room_id);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return (bookings ?? []).filter((b) => {
      if (filter === "aktif" && b.status !== "terjadwal" && b.status !== "checkin") return false;
      if (!q) return true;
      return [b.guest_nama, b.guest_hp ?? "", b.room_nomor ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [bookings, filter, cari]);

  function gagal(e: unknown) {
    toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
  }

  function bukaBaru() {
    setEditing(null);
    setForm({ ...FORM_KOSONG, tgl_checkin: todayISO(), tgl_checkout: besok() });
    setOpen(true);
  }

  function bukaUbah(b: ElBooking) {
    setEditing(b);
    setForm({
      room_id: b.room_id ?? "",
      guest_nama: b.guest_nama,
      guest_hp: b.guest_hp ?? "",
      sumber: b.sumber,
      tgl_checkin: b.tgl_checkin,
      tgl_checkout: b.tgl_checkout,
      adults: b.adults,
      children: b.children,
      total_bayar: String(b.total_bayar ?? ""),
      catatan: b.catatan ?? "",
    });
    setOpen(true);
  }

  async function simpan() {
    if (!form.room_id || !form.guest_nama.trim() || !tanggalValid) {
      toast("⚠", "Lengkapi form", "Kamar, nama tamu, dan tanggal (check-out setelah check-in) wajib diisi.", "ruby");
      return;
    }
    if (kamarTerpilih && !kamarTerpilih.tersedia) {
      toast("⚠", "Kamar tidak tersedia", `Kamar ${kamarTerpilih.nomor} ${kamarTerpilih.alasan ?? "tidak tersedia"} di tanggal itu.`, "ruby");
      return;
    }
    setBusy(true);
    try {
      const isi = { ...form, guest_nama: form.guest_nama.trim(), total_bayar: Number(form.total_bayar || 0) };
      if (editing) {
        await api.patch("/el/bookings", { id: editing.id, ...isi });
        const pindah = editing.status === "checkin" && editing.room_id !== form.room_id;
        toast("✓", pindah ? "Tamu dipindah" : "Booking diubah", pindah ? `${form.guest_nama} → kamar ${kamarTerpilih?.nomor ?? ""}` : form.guest_nama, "sage");
      } else {
        await api.post("/el/bookings", isi);
        toast("✓", "Booking dibuat", form.guest_nama, "sage");
      }
      setOpen(false);
      setEditing(null);
      setForm(FORM_KOSONG);
      load();
    } catch (e) {
      gagal(e);
    } finally {
      setBusy(false);
    }
  }

  async function batalkan(b: ElBooking) {
    if (!confirm(`Batalkan booking ${b.guest_nama}?`)) return;
    setBusy(true);
    try {
      await api.patch("/el/bookings", { id: b.id, action: "batal" });
      toast("✓", "Dibatalkan", b.guest_nama, "sage");
      load();
    } catch (e) {
      gagal(e);
    } finally {
      setBusy(false);
    }
  }

  async function finalizeCheckin(data: CheckinCardResult) {
    if (!checkinFor) return;
    // Error dilempar ke CheckinCard, yang menampilkan toast dan membiarkan
    // kartu tetap terbuka supaya foto & tanda tangan tidak perlu diulang.
    await api.patch("/el/bookings", {
      id: checkinFor.id,
      action: "checkin",
      ktp_photo_path: data.ktpPhotoPath,
      signature_data_url: data.signatureDataUrl,
      guest_hp: data.guestHp,
    });
    toast("🛎️", "Check-In Berhasil", `${checkinFor.guest_nama} — Kamar ${checkinFor.room_nomor ?? ""}`, "sage");
    setCheckinFor(null);
    load();
  }

  function bukaCheckout(b: ElBooking) {
    setKondisi(KONDISI[0]);
    setCatatanKondisi("");
    setCheckoutFor(b);
  }

  async function doCheckout() {
    if (!checkoutFor || busy) return;
    setBusy(true);
    try {
      const teks = catatanKondisi.trim() ? `${kondisi}. ${catatanKondisi.trim()}` : kondisi;
      await api.patch("/el/bookings", { id: checkoutFor.id, action: "checkout", kondisi: teks });
      toast("✓", "Check-out", `${checkoutFor.guest_nama} — kamar ${checkoutFor.room_nomor ?? ""} masuk daftar housekeeping`, "sage");
      setCheckoutFor(null);
      load();
    } catch (e) {
      gagal(e);
    } finally {
      setBusy(false);
    }
  }

  const sedangMenginap = editing?.status === "checkin";

  return (
    <ExcellentShell pageTitle="Booking" pageSub="Loonars Excellent Living">
      <Card>
        <CardHeader
          title="Daftar Booking"
          subtitle="Mulai 7 hari terakhir"
          action={<Btn variant="primary" onClick={bukaBaru}>+ Booking</Btn>}
        />
        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          {(["aktif", "semua"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`text-[11px] px-3 py-1 rounded-full border ${filter === f ? "bg-gold-500/15 border-gold-500/40 text-gold-600" : "border-ink/10 text-ink/50"}`}
            >
              {f === "aktif" ? "Terjadwal & menginap" : "Semua"}
            </button>
          ))}
          <input
            className={`${inputCls} max-w-[220px] ml-auto`}
            placeholder="Cari nama, HP, kamar"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
          />
        </div>
        {!bookings ? (
          <Loading />
        ) : tampil.length === 0 ? (
          <Empty label={bookings.length === 0 ? "Belum ada booking" : "Tidak ada booking yang cocok"} />
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
                {tampil.map((b) => (
                  <tr key={b.id} className="border-t border-ink/[0.05]">
                    <td className="px-3.5 py-2.5 font-semibold text-ink">{b.room_nomor ?? "—"}</td>
                    <td className="px-3.5 py-2.5 text-ink/70">
                      {b.guest_nama}
                      {b.guest_hp && <div className="text-[10.5px] text-ink/35">{b.guest_hp}</div>}
                    </td>
                    <td className="px-3.5 py-2.5 text-ink/60 whitespace-nowrap">
                      {b.tgl_checkin} → {b.tgl_checkout}
                      <div className="text-[10.5px] text-ink/35">{b.durasi_malam ?? "-"} malam · {b.adults} dewasa{b.children ? `, ${b.children} anak` : ""}</div>
                    </td>
                    <td className="px-3.5 py-2.5 text-ink/60">{b.sumber}</td>
                    <td className="px-3.5 py-2.5 text-right text-ink/70 whitespace-nowrap">{fmtCurrencyFull(b.total_bayar)}</td>
                    <td className="px-3.5 py-2.5"><Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge></td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap text-right">
                      {b.status === "terjadwal" && (
                        <span className="inline-flex gap-2">
                          <Btn variant="primary" disabled={busy} onClick={() => setCheckinFor(b)}>Check-in</Btn>
                          <Btn disabled={busy} onClick={() => bukaUbah(b)}>Ubah</Btn>
                          <Btn disabled={busy} onClick={() => batalkan(b)}>Batal</Btn>
                        </span>
                      )}
                      {b.status === "checkin" && (
                        <span className="inline-flex gap-2">
                          <Btn variant="primary" disabled={busy} onClick={() => bukaCheckout(b)}>Check-out</Btn>
                          <Btn disabled={busy} onClick={() => bukaUbah(b)}>Ubah / Pindah</Btn>
                        </span>
                      )}
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
        title={editing ? (sedangMenginap ? "Ubah Booking / Pindah Kamar" : "Ubah Booking") : "Booking Baru"}
        onClose={() => setOpen(false)}
        footer={<><Btn onClick={() => setOpen(false)}>Batal</Btn><Btn variant="primary" disabled={busy} onClick={simpan}>Simpan</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Check-in">
            <input
              type="date"
              className={inputCls}
              value={form.tgl_checkin}
              disabled={sedangMenginap}
              onChange={(e) => {
                const v = e.target.value;
                setForm({ ...form, tgl_checkin: v, tgl_checkout: form.tgl_checkout > v ? form.tgl_checkout : besok(v) });
              }}
            />
          </Field>
          <Field label="Check-out">
            <input type="date" className={inputCls} value={form.tgl_checkout} min={besok(form.tgl_checkin)} onChange={(e) => setForm({ ...form, tgl_checkout: e.target.value })} />
          </Field>
        </div>
        <Field label={tanggalValid && kamar ? `Kamar (${jumlahKosong} kosong di tanggal ini)` : "Kamar"}>
          <select className={inputCls} value={form.room_id} disabled={!tanggalValid || !kamar} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
            <option value="">{!tanggalValid ? "Isi tanggal dulu" : !kamar ? "Memuat kamar…" : "Pilih kamar"}</option>
            {kamarPerTipe.map(([tipe, list]) => (
              <optgroup key={tipe} label={tipe}>
                {list.map((r) => {
                  // Tamu yang sedang menginap hanya bisa dipindah ke kamar yang sudah siap.
                  const belumSiap = sedangMenginap && r.id !== editing?.room_id && r.status !== "available";
                  const bisa = r.tersedia && !belumSiap;
                  return (
                    <option key={r.id} value={r.id} disabled={!bisa && r.id !== form.room_id}>
                      {r.nomor}
                      {!r.tersedia ? ` — ${r.alasan ?? "tidak tersedia"}` : belumSiap ? ` — belum siap (${r.status})` : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </Field>
        {sedangMenginap && editing?.room_id !== form.room_id && form.room_id && (
          <div className="-mt-2 mb-3 text-[11px] text-gold-600">
            Tamu dipindah: kamar lama {editing?.room_nomor} jadi Kotor dan masuk daftar housekeeping.
          </div>
        )}
        <Field label="Nama Tamu"><input className={inputCls} value={form.guest_nama} onChange={(e) => setForm({ ...form, guest_nama: e.target.value })} /></Field>
        <Field label="No. HP / WhatsApp (opsional, wajib saat check-in)"><input type="tel" className={inputCls} value={form.guest_hp} onChange={(e) => setForm({ ...form, guest_hp: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
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

      <Modal
        open={!!checkoutFor}
        title="Check-out"
        onClose={() => setCheckoutFor(null)}
        footer={<><Btn onClick={() => setCheckoutFor(null)}>Batal</Btn><Btn variant="primary" disabled={busy} onClick={doCheckout}>Check-out</Btn></>}
      >
        {checkoutFor && (
          <div className="text-[12px] text-ink/60 mb-4">
            {checkoutFor.guest_nama} · Kamar {checkoutFor.room_nomor ?? "—"} · {checkoutFor.tgl_checkin} → {checkoutFor.tgl_checkout}
          </div>
        )}
        <Field label="Kondisi Kamar">
          <select className={inputCls} value={kondisi} onChange={(e) => setKondisi(e.target.value)}>
            {KONDISI.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Catatan Kondisi (opsional)">
          <input className={inputCls} value={catatanKondisi} onChange={(e) => setCatatanKondisi(e.target.value)} placeholder="Cth: handuk hilang satu" />
        </Field>
      </Modal>

      <CheckinCard
        open={!!checkinFor}
        guest={
          checkinFor
            ? {
                guestName: checkinFor.guest_nama,
                unitNomor: checkinFor.room_nomor ?? "-",
                tipe: `${checkinFor.durasi_malam ?? "-"} malam`,
                checkinDate: checkinFor.tgl_checkin,
                checkoutDate: checkinFor.tgl_checkout,
                guestHp: checkinFor.guest_hp,
              }
            : null
        }
        onClose={() => setCheckinFor(null)}
        onConfirm={finalizeCheckin}
        houseRules={HOUSE_RULES_EXCELLENT_LIVING}
        unitLabel="Kamar"
      />
    </ExcellentShell>
  );
}
