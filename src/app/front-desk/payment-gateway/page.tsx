"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { AdminShell } from "../../admin/_shell";
import { FrontDeskShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, fmtDate, todayISO } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { StatCard } from "@/components/StatCard";
import type { Booking, Unit, UnitAvailability, WalkinKategori, WalkinPayment, WalkinStatus } from "@/lib/types";
import { loadQrisImage, saveQrisImage, clearQrisImage } from "@/lib/walkin";

type KasirKategori = WalkinKategori | "villa";

interface DisplayPayment {
  source: "walkin" | "villa";
  id: string;
  guest_nama: string;
  guest_hp: string | null;
  kategori: KasirKategori;
  deskripsi: string;
  jumlah: number;
  status: WalkinStatus;
  created_at: string;
  unit_id?: string;
  unit_nomor?: string;
  tipe?: Booking["tipe"];
}

const kategoriLabel: Record<KasirKategori, string> = { cafe: "Cafe", spa: "Spa", villa: "Villa", lainnya: "Lainnya" };
const kategoriIcon: Record<KasirKategori, string> = { cafe: "☕", spa: "💆", villa: "🏡", lainnya: "◍" };
const statusTone: Record<WalkinStatus, "ok" | "pending" | "danger"> = { pending: "pending", lunas: "ok", batal: "danger" };
const statusLabel: Record<WalkinStatus, string> = { pending: "Menunggu Bayar", lunas: "Lunas", batal: "Dibatalkan" };
const bookingStatusLabel: Record<string, string> = { terjadwal: "Menunggu Check-In", checkin: "Sudah Check-In", checkout: "Selesai", batal: "Dibatalkan" };
const amountPresets = [25000, 50000, 100000, 150000, 250000];

function toDisplay(w: WalkinPayment): DisplayPayment {
  return {
    source: "walkin",
    id: w.id,
    guest_nama: w.guest_nama,
    guest_hp: w.guest_hp,
    kategori: w.kategori,
    deskripsi: w.deskripsi,
    jumlah: w.jumlah,
    status: w.status,
    created_at: w.created_at,
  };
}

function bookingStatusToDisplay(status: Booking["status"]): WalkinStatus {
  if (status === "checkin" || status === "checkout") return "lunas";
  if (status === "batal") return "batal";
  return "pending";
}

function bookingToDisplay(b: Booking): DisplayPayment {
  return {
    source: "villa",
    id: b.id,
    guest_nama: b.guest_nama,
    guest_hp: b.guest_hp ?? null,
    kategori: "villa",
    deskripsi: `Sewa Villa Unit ${b.unit_nomor} · ${b.tipe === "harian" ? "Harian" : "Bulanan"} · ${fmtDate(b.tgl_checkin)}`,
    jumlah: b.total_bayar ?? b.tarif,
    status: bookingStatusToDisplay(b.status),
    created_at: b.created_at,
    unit_id: b.unit_id,
    unit_nomor: b.unit_nomor,
    tipe: b.tipe,
  };
}

export default function PaymentGatewayPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<WalkinPayment[]>([]);
  const [villaBookings, setVillaBookings] = useState<Booking[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [availUnits, setAvailUnits] = useState<UnitAvailability[] | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [qris, setQris] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activePayment, setActivePayment] = useState<DisplayPayment | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | WalkinStatus>("all");

  const [form, setForm] = useState({
    guest_nama: "",
    guest_hp: "",
    kategori: "cafe" as KasirKategori,
    deskripsi: "",
    jumlah: "" as string,
    unit_id: "",
    tipe: "harian" as Booking["tipe"],
    checkin: todayISO(),
    checkout: todayISO(),
    tarif: "" as string,
  });

  function load() {
    api
      .get<WalkinPayment[]>("/walkin-payments")
      .then((r) => setRows(r || []))
      .catch((e) => toast("⚠", "Gagal memuat", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby"));
    api
      .get<Booking[]>("/bookings")
      .then((b) => setVillaBookings((b || []).filter((x) => x.sumber === "walk-in")))
      .catch(() => {});
    api
      .get<Unit[]>("/units")
      .then((u) => setUnits(u || []))
      .catch(() => {});
  }

  useEffect(() => {
    if (!user) return;
    load();
    loadQrisImage()
      .then(setQris)
      .catch((e) => toast("⚠", "Gagal memuat QRIS", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  useEffect(() => {
    if (form.kategori !== "villa" || !form.checkin) return;
    let cancelled = false;
    setAvailLoading(true);
    const params = new URLSearchParams({ checkin: form.checkin });
    if (form.checkout) params.set("checkout", form.checkout);
    api
      .get<UnitAvailability[]>(`/availability?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setAvailUnits(res || []);
      })
      .finally(() => {
        if (!cancelled) setAvailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.kategori, form.checkin, form.checkout]);

  const filteredRows = useMemo(
    () => (filterStatus === "all" ? rows : rows.filter((r) => r.status === filterStatus)),
    [rows, filterStatus]
  );

  const todayStr = new Date().toDateString();
  const todayRows = rows.filter((r) => new Date(r.created_at).toDateString() === todayStr);
  const todayLunas = todayRows.filter((r) => r.status === "lunas");
  const totalHariIni = todayLunas.reduce((s, r) => s + r.jumlah, 0);
  const pendingCount = rows.filter((r) => r.status === "pending").length + villaBookings.filter((b) => b.status === "terjadwal").length;
  const cafeTotal = todayLunas.filter((r) => r.kategori === "cafe").reduce((s, r) => s + r.jumlah, 0);
  const spaTotal = todayLunas.filter((r) => r.kategori === "spa").reduce((s, r) => s + r.jumlah, 0);

  function onUploadQris(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      toast("⚠", "Gambar terlalu besar", "Ukuran maksimal 1.5MB — kompres/perkecil gambar QRIS dulu.", "ruby");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        await saveQrisImage(dataUrl);
        setQris(dataUrl);
        toast("✓", "QRIS disimpan", "Gambar QRIS statis berhasil diunggah.", "sage");
      } catch (e) {
        toast("⚠", "Gagal menyimpan QRIS", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
      }
    };
    reader.readAsDataURL(file);
  }

  async function removeQris() {
    try {
      await clearQrisImage();
      setQris(null);
    } catch (e) {
      toast("⚠", "Gagal menghapus QRIS", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  function resetForm(kategori: KasirKategori) {
    setForm({
      guest_nama: "",
      guest_hp: "",
      kategori,
      deskripsi: "",
      jumlah: "",
      unit_id: "",
      tipe: "harian",
      checkin: todayISO(),
      checkout: todayISO(),
      tarif: "",
    });
    setAvailUnits(null);
  }

  async function createWalkinPayment() {
    const jumlahNum = Number(form.jumlah.replace(/[^0-9]/g, ""));
    if (!form.guest_nama.trim()) {
      toast("⚠", "Lengkapi form", "Nama tamu wajib diisi.", "ruby");
      return;
    }
    if (!jumlahNum || jumlahNum <= 0) {
      toast("⚠", "Lengkapi form", "Nominal pembayaran harus lebih dari 0.", "ruby");
      return;
    }
    try {
      const payment = await api.post<WalkinPayment>("/walkin-payments", {
        guest_nama: form.guest_nama.trim(),
        guest_hp: form.guest_hp.trim() || null,
        kategori: form.kategori as WalkinKategori,
        deskripsi: form.deskripsi.trim() || kategoriLabel[form.kategori],
        jumlah: jumlahNum,
      });
      setRows((prev) => [payment, ...prev]);
      setActivePayment(toDisplay(payment));
      resetForm(form.kategori);
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function createVillaBooking() {
    const unit = units.find((u) => u.id === form.unit_id);
    if (!form.guest_nama.trim() || !unit) {
      toast("⚠", "Lengkapi form", "Isi nama tamu dan pilih unit.", "ruby");
      return;
    }
    const avail = availUnits?.find((u) => u.id === form.unit_id);
    if (avail && !avail.tersedia_untuk_tanggal) {
      toast("⚠", "Unit Tidak Tersedia", `Unit ${unit.nomor} sudah dibooking ${avail.dibooking_oleh} untuk tanggal ini.`, "ruby");
      return;
    }
    const tarif = Number(form.tarif) || (form.tipe === "harian" ? 500000 : 8000000);
    try {
      const booking = await api.post<Booking>("/bookings", {
        unit_id: unit.id,
        unit_nomor: unit.nomor,
        guest_nama: form.guest_nama.trim(),
        tipe: form.tipe,
        sumber: "walk-in",
        tgl_checkin: form.checkin,
        tgl_checkout: form.checkout,
        tarif,
        total_bayar: tarif,
        guest_hp: form.guest_hp.trim() || undefined,
      });
      setVillaBookings((prev) => [booking, ...prev]);
      setActivePayment(bookingToDisplay(booking));
      resetForm("villa");
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function createPayment() {
    if (form.kategori === "villa") return createVillaBooking();
    return createWalkinPayment();
  }

  async function setStatus(payment: DisplayPayment, status: WalkinStatus) {
    try {
      if (payment.source === "walkin") {
        const updated = await api.patch<WalkinPayment>("/walkin-payments", { id: payment.id, status });
        setRows((prev) => prev.map((r) => (r.id === payment.id ? updated : r)));
        setActivePayment(toDisplay(updated));
        if (status === "lunas") toast("✓", "Pembayaran lunas", "Transaksi walk-in berhasil dicatat sebagai lunas.", "sage");
      } else if (status === "lunas") {
        await api.post("/checkin", {
          booking_id: payment.id,
          unit_id: payment.unit_id,
          unit_nomor: payment.unit_nomor,
          guest_nama: payment.guest_nama,
          guest_hp: payment.guest_hp,
          tipe: payment.tipe,
          total_bayar: payment.jumlah,
          checkin_by: user?.nama || "Admin",
        });
        setVillaBookings((prev) => prev.map((b) => (b.id === payment.id ? { ...b, status: "checkin" } : b)));
        setActivePayment({ ...payment, status: "lunas" });
        toast("🛎️", "Check-In Berhasil", `${payment.guest_nama} — Unit ${payment.unit_nomor} sudah check-in. PIN pintu terkirim via WA.`, "sage");
      } else {
        await api.patch("/bookings", { id: payment.id, status: "batal" });
        setVillaBookings((prev) => prev.map((b) => (b.id === payment.id ? { ...b, status: "batal" } : b)));
        setActivePayment({ ...payment, status: "batal" });
      }
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  const Shell = user?.role === "admin" ? AdminShell : FrontDeskShell;

  if (!user) {
    return (
      <Shell pageTitle="Payment Gateway">
        <Loading />
      </Shell>
    );
  }

  const availOptions = availUnits ?? units.map((u) => ({ ...u, tersedia_untuk_tanggal: u.status === "available", dibooking_oleh: null }));

  return (
    <Shell pageTitle="Payment Gateway" pageSub="Kasir walk-in — Villa, Cafe & Spa">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Pemasukan Hari Ini" value={fmtCurrencyFull(totalHariIni)} sub={`${todayLunas.length} transaksi lunas · cafe/spa`} accent="sage" icon="✓" />
        <StatCard label="Menunggu Bayar" value={String(pendingCount)} accent={pendingCount ? "gold" : "neutral"} icon="⏳" />
        <StatCard label="Cafe Hari Ini" value={fmtCurrencyFull(cafeTotal)} accent="azure" icon="☕" />
        <StatCard label="Spa Hari Ini" value={fmtCurrencyFull(spaTotal)} accent="ruby" icon="💆" />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardHeader
              title="Kasir Walk-in"
              subtitle="Isi data tamu, lalu buat QRIS pembayaran"
              action={
                <button onClick={() => setShowSettings((v) => !v)} className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0">
                  {showSettings ? "Tutup" : "⚙ QRIS"}
                </button>
              }
            />
            {showSettings && (
              <div className="px-4 sm:px-5 py-4 border-b border-ink/[0.05] bg-base-800/40">
                <div className="text-[10px] text-ink/40 mb-2">
                  Unggah gambar QRIS statis milik villa (dari e-wallet/rekening). Gambar ini akan ditampilkan bersama nominal setiap transaksi.
                </div>
                <div className="flex items-center gap-3">
                  {qris && <img src={qris} alt="QRIS" className="w-16 h-16 rounded object-cover border border-ink/10" />}
                  <label className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 cursor-pointer">
                    Pilih Gambar
                    <input type="file" accept="image/*" className="hidden" onChange={onUploadQris} />
                  </label>
                  {qris && (
                    <button onClick={removeQris} className="text-[10.5px] font-semibold text-ruby-400">
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            )}
            <CardBody>
              <Field label="Nama Tamu">
                <input className={inputCls} value={form.guest_nama} onChange={(e) => setForm({ ...form, guest_nama: e.target.value })} placeholder="Nama walk-in customer" />
              </Field>
              <Field label="No. HP (opsional)">
                <input className={inputCls} value={form.guest_hp} onChange={(e) => setForm({ ...form, guest_hp: e.target.value })} placeholder="+62 8xx-xxxx-xxxx" />
              </Field>
              <Field label="Kategori">
                <div className="flex gap-2">
                  {(Object.keys(kategoriLabel) as KasirKategori[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => resetForm(k)}
                      className={`flex-1 py-2.5 rounded-lg text-[11.5px] font-semibold transition ${
                        form.kategori === k ? "bg-gold-500 text-base-950" : "bg-base-800 text-ink/50 border border-ink/10"
                      }`}
                    >
                      <span className="mr-1">{kategoriIcon[k]}</span>
                      {kategoriLabel[k]}
                    </button>
                  ))}
                </div>
              </Field>

              {form.kategori === "villa" ? (
                <>
                  <div className="text-[10px] text-ink/40 -mt-1 mb-4 leading-relaxed">
                    Untuk tamu yang datang langsung (bukan lewat OTA/Cloudbeds). Setelah lunas, otomatis jadi booking + check-in dan tercatat sebagai pendapatan sewa (masuk bagi hasil 70/30 investor) — beda dari cafe/spa.
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label={`Unit${availLoading ? " — mengecek…" : ""}`}>
                      <select className={inputCls} value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
                        <option value="">Pilih unit</option>
                        {availOptions.map((u) => (
                          <option key={u.id} value={u.id} disabled={!u.tersedia_untuk_tanggal}>
                            Unit {u.nomor}{!u.tersedia_untuk_tanggal ? ` — dibooking (${u.dibooking_oleh ?? u.status})` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Tipe">
                      <select className={inputCls} value={form.tipe} onChange={(e) => setForm({ ...form, tipe: e.target.value as Booking["tipe"] })}>
                        <option value="harian">Harian</option>
                        <option value="bulanan">Bulanan</option>
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Check-in">
                      <input type="date" className={inputCls} value={form.checkin} onChange={(e) => setForm({ ...form, checkin: e.target.value })} />
                    </Field>
                    <Field label="Check-out">
                      <input type="date" className={inputCls} value={form.checkout} onChange={(e) => setForm({ ...form, checkout: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Tarif (Rp)">
                    <input
                      type="number"
                      className={inputCls}
                      value={form.tarif}
                      onChange={(e) => setForm({ ...form, tarif: e.target.value })}
                      placeholder={form.tipe === "harian" ? "500000" : "8000000"}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Deskripsi Item / Layanan">
                    <input className={inputCls} value={form.deskripsi} onChange={(e) => setForm({ ...form, deskripsi: e.target.value })} placeholder="Cth: 2x Kopi Susu, Pijat 60 menit" />
                  </Field>
                  <Field label="Nominal">
                    <input
                      className={inputCls}
                      value={form.jumlah}
                      onChange={(e) => setForm({ ...form, jumlah: e.target.value.replace(/[^0-9]/g, "") })}
                      placeholder="0"
                      inputMode="numeric"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {amountPresets.map((p) => (
                        <button
                          key={p}
                          onClick={() => setForm({ ...form, jumlah: String(p) })}
                          className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-base-800 text-ink/50 border border-ink/10 hover:border-gold-500/40 hover:text-gold-500 transition"
                        >
                          {fmtCurrencyFull(p)}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}

              <button onClick={createPayment} className="w-full mt-1 bg-gold-500 text-base-950 rounded-lg py-3 text-[12.5px] font-semibold tracking-wide hover:opacity-90 active:scale-[0.99] transition">
                {form.kategori === "villa" ? "Buat Booking & QRIS Pembayaran" : "Buat QRIS Pembayaran"}
              </button>
            </CardBody>
          </Card>

          {villaBookings.length > 0 && (
            <Card>
              <CardHeader title="Booking Villa Walk-in Terbaru" subtitle="Dibuat lewat Payment Gateway ini" />
              <div className="max-h-[280px] overflow-y-auto">
                {villaBookings.slice(0, 10).map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setActivePayment(bookingToDisplay(b))}
                    className="w-full text-left flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 hover:bg-ink/[0.03] transition"
                  >
                    <div className="w-8 h-8 rounded-full bg-gold-500/10 flex items-center justify-center text-sm shrink-0">🏡</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-ink/80 truncate">{b.guest_nama}</div>
                      <div className="text-[10px] text-ink/30 mt-0.5 truncate">
                        Unit {b.unit_nomor} · {fmtDate(b.tgl_checkin)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11.5px] font-semibold text-ink/80">{fmtCurrencyFull(b.total_bayar ?? b.tarif)}</div>
                      <Badge tone={statusTone[bookingStatusToDisplay(b.status)]}>{bookingStatusLabel[b.status] || b.status}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Riwayat Transaksi"
              subtitle={`${filteredRows.length} transaksi cafe/spa/lainnya`}
              action={
                <select
                  className="bg-base-800 border border-ink/10 rounded text-[10.5px] px-2 py-1.5 text-ink/60"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as "all" | WalkinStatus)}
                >
                  <option value="all">Semua</option>
                  <option value="pending">Menunggu</option>
                  <option value="lunas">Lunas</option>
                  <option value="batal">Batal</option>
                </select>
              }
            />
            <div className="max-h-[560px] overflow-y-auto">
              {filteredRows.length === 0 ? (
                <Loading label="Belum ada transaksi walk-in" />
              ) : (
                filteredRows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setActivePayment(toDisplay(r))}
                    className="w-full text-left flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 hover:bg-ink/[0.03] transition"
                  >
                    <div className="w-8 h-8 rounded-full bg-gold-500/10 flex items-center justify-center text-sm shrink-0">{kategoriIcon[r.kategori]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-ink/80 truncate">{r.guest_nama}</div>
                      <div className="text-[10px] text-ink/30 mt-0.5 truncate">
                        {r.deskripsi} · {fmtDate(r.created_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11.5px] font-semibold text-ink/80">{fmtCurrencyFull(r.jumlah)}</div>
                      <Badge tone={statusTone[r.status]}>{statusLabel[r.status]}</Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={!!activePayment}
        title={activePayment?.source === "villa" ? "QRIS Pembayaran Sewa Villa" : "QRIS Pembayaran"}
        onClose={() => setActivePayment(null)}
        footer={
          activePayment && activePayment.status === "pending" ? (
            <>
              <Btn onClick={() => activePayment && setStatus(activePayment, "batal")}>Batalkan</Btn>
              <Btn variant="primary" onClick={() => activePayment && setStatus(activePayment, "lunas")}>
                {activePayment.source === "villa" ? "Tandai Lunas & Check-In" : "Tandai Lunas"}
              </Btn>
            </>
          ) : (
            <Btn variant="primary" onClick={() => setActivePayment(null)}>
              Tutup
            </Btn>
          )
        }
      >
        {activePayment && (
          <div className="text-center">
            <Badge tone={statusTone[activePayment.status]}>{statusLabel[activePayment.status]}</Badge>
            <div className="mt-4 mb-2 flex justify-center">
              {qris ? (
                <img src={qris} alt="QRIS" className="w-56 h-56 rounded-lg object-contain border border-ink/10 bg-white p-2" />
              ) : (
                <div className="w-56 h-56 rounded-lg border border-dashed border-ink/15 flex items-center justify-center text-[11px] text-ink/30 px-4 text-center">
                  QRIS belum diunggah. Buka pengaturan ⚙ QRIS untuk mengunggah gambar QRIS statis villa.
                </div>
              )}
            </div>
            <div className="font-serif text-2xl font-medium text-ink">{fmtCurrencyFull(activePayment.jumlah)}</div>
            <div className="text-xs text-ink/50 mt-1">{activePayment.deskripsi}</div>
            <div className="text-[10px] text-ink/30 mt-3">
              {activePayment.guest_nama} {activePayment.guest_hp ? `· ${activePayment.guest_hp}` : ""}
            </div>
            <div className="text-[10px] text-ink/20 mt-1">
              {fmtDate(activePayment.created_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        )}
      </Modal>
    </Shell>
  );
}
