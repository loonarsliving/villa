"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FrontDeskShell } from "./_shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, fmtDate, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { Booking, Summary, Unit, UnitAvailability, Notification } from "@/lib/types";

const statusColor: Record<string, string> = {
  available: "border-sage-500/30",
  occupied: "bg-base-700 border-gold-500/25",
  checkout: "bg-gold-500/10 border-gold-500/40",
  dirty: "border-dashed border-ink/15",
  maintenance: "bg-ruby-500/10 border-ruby-500/30",
};
const statusLabel: Record<string, string> = {
  available: "Tersedia",
  occupied: "Terisi",
  checkout: "Checkout",
  dirty: "Kotor",
  maintenance: "Maintenance",
};

export default function FrontDeskPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [sum, setSum] = useState<Summary | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [ciOpen, setCiOpen] = useState(false);
  const [coOpen, setCoOpen] = useState(false);

  const [ci, setCi] = useState({ nama: "", ktp: "", unit_id: "", tipe: "harian", checkin: todayISO(), checkout: todayISO(), src: "walk-in", hp: "", tarif: "" });
  const [availUnits, setAvailUnits] = useState<UnitAvailability[] | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [ciTab, setCiTab] = useState<"existing" | "new">("existing");
  const [scheduledBookings, setScheduledBookings] = useState<Booking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [coUnitId, setCoUnitId] = useState("");
  const [coCond, setCoCond] = useState("Baik — tidak ada kerusakan");
  const [coNote, setCoNote] = useState("");

  async function load() {
    setLoading(true);
    const [s, u, n] = await Promise.all([
      api.get<Summary>("/summary"),
      api.get<Unit[]>("/units"),
      api.get<Notification[]>("/notifications?role=all"),
    ]);
    setSum(s);
    setUnits(u || []);
    setNotifs(n || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!ciOpen || !ci.checkin) return;
    let cancelled = false;
    setAvailLoading(true);
    const params = new URLSearchParams({ checkin: ci.checkin });
    if (ci.checkout) params.set("checkout", ci.checkout);
    api
      .get<UnitAvailability[]>(`/availability?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setAvailUnits(res || []);
        setCi((prev) => (prev.unit_id && !res?.find((u) => u.id === prev.unit_id)?.tersedia_untuk_tanggal ? { ...prev, unit_id: "" } : prev));
      })
      .finally(() => {
        if (!cancelled) setAvailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ciOpen, ci.checkin, ci.checkout]);

  function openCheckin() {
    setCi({ nama: "", ktp: "", unit_id: "", tipe: "harian", checkin: todayISO(), checkout: todayISO(), src: "walk-in", hp: "", tarif: "" });
    setAvailUnits(null);
    setSelectedBookingId("");
    setCiTab("existing");
    setCiOpen(true);
    api
      .get<Booking[]>("/bookings?status=terjadwal")
      .then((b) => setScheduledBookings(b || []))
      .catch(() => setScheduledBookings([]));
  }
  function openCheckout() {
    const occ = units.filter((u) => u.status === "occupied" || u.status === "checkout");
    setCoUnitId(occ[0]?.id || "");
    setCoOpen(true);
  }

  // Check-in a booking that already exists (Cloudbeds/OTA-synced or logged
  // earlier) -- never creates a new booking, since that already conflicts
  // (409) against the existing one. Already paid via its own channel, so
  // no payment step here.
  async function doCheckinExisting() {
    const bk = scheduledBookings.find((b) => b.id === selectedBookingId);
    if (!bk) {
      toast("⚠", "Pilih booking", "Pilih salah satu booking terjadwal untuk di-check-in.", "ruby");
      return;
    }
    try {
      await api.post("/checkin", {
        booking_id: bk.id,
        unit_id: bk.unit_id,
        unit_nomor: bk.unit_nomor,
        guest_nama: bk.guest_nama,
        guest_hp: bk.guest_hp,
        tipe: bk.tipe,
        total_bayar: bk.total_bayar ?? bk.tarif,
        checkin_by: user?.nama || "Staff",
      });
      setCiOpen(false);
      toast("🛎️", "Check-In Berhasil", `${bk.guest_nama} — Unit ${bk.unit_nomor} sudah check-in.`, "sage");
      setTimeout(() => toast("📱", "Investor Unit Diberitahu", `Notifikasi terkirim ke dashboard investor Unit ${bk.unit_nomor}.`, "gold"), 1000);
      load();
    } catch (e) {
      toast("⚠", "Check-In Gagal", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  // A guest with no booking in the system yet. Walk-in (villa's own direct
  // sale) must be paid via QRIS first -- handled entirely by Payment
  // Gateway, so we just hand off there instead of duplicating that flow.
  // Any other source here means staff is manually logging a booking made
  // through that channel (already paid there) -- same immediate
  // create+checkin as before, tarif entered manually since that's the
  // external channel's own price, not villa's base rate.
  async function doCheckinNew() {
    if (ci.src === "walk-in") {
      setCiOpen(false);
      router.push("/front-desk/payment-gateway?kategori=villa");
      return;
    }
    const unit = units.find((u) => u.id === ci.unit_id);
    if (!ci.unit_id || !ci.nama.trim() || !unit) {
      toast("⚠", "Lengkapi form", "Isi nama tamu dan pilih unit.", "ruby");
      return;
    }
    const avail = availUnits?.find((u) => u.id === ci.unit_id);
    if (avail && !avail.tersedia_untuk_tanggal) {
      toast("⚠", "Unit Tidak Tersedia", `Unit ${unit.nomor} sudah dibooking ${avail.dibooking_oleh} untuk tanggal ini.`, "ruby");
      return;
    }
    const tarif = Number(ci.tarif);
    if (!tarif || tarif <= 0) {
      toast("⚠", "Lengkapi form", "Isi tarif sesuai harga dari sumber booking.", "ruby");
      return;
    }
    try {
      const bk = await api.post<{ id: string }>("/bookings", {
        unit_id: unit.id,
        unit_nomor: unit.nomor,
        guest_nama: ci.nama,
        tipe: ci.tipe,
        sumber: ci.src,
        tgl_checkin: ci.checkin,
        tgl_checkout: ci.checkout,
        tarif,
        total_bayar: tarif,
        guest_hp: ci.hp,
        guest_ktp: ci.ktp,
      });
      await api.post("/checkin", {
        booking_id: bk.id,
        unit_id: unit.id,
        unit_nomor: unit.nomor,
        guest_nama: ci.nama,
        tipe: ci.tipe,
        total_bayar: tarif,
        checkin_by: user?.nama || "Staff",
      });
      setCiOpen(false);
      toast("🛎️", "Check-In Berhasil", `${ci.nama} — Unit ${unit.nomor} sudah check-in.`, "sage");
      setTimeout(() => toast("📱", "Investor Unit Diberitahu", `Notifikasi terkirim ke dashboard investor Unit ${unit.nomor}.`, "gold"), 1000);
      load();
    } catch (e) {
      toast("⚠", "Check-In Gagal", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function doCheckout() {
    const unit = units.find((u) => u.id === coUnitId);
    if (!unit) return;
    const bks = await api.get<{ id: string; guest_nama: string }[]>(`/bookings?unit_id=${unit.id}&status=checkin`);
    const bk = bks?.[0];
    if (!bk) {
      toast("⚠", "Error", "Tidak ada booking aktif untuk unit ini.", "ruby");
      return;
    }
    await api.post("/checkout", {
      booking_id: bk.id,
      unit_id: unit.id,
      unit_nomor: unit.nomor,
      guest_nama: bk.guest_nama,
      kondisi: coCond,
      checkout_by: user?.nama || "Staff",
    });
    setCoOpen(false);
    toast("👋", "Checkout Diproses", `Unit ${unit.nomor} checkout. Housekeeping dijadwalkan.`, "gold");
    load();
  }

  const occupiedUnits = units.filter((u) => u.status === "occupied" || u.status === "checkout");

  const agenda: { title: string; sub: string; time: string; dot: string }[] = [];
  units.filter((u) => u.status === "checkout").forEach((u) => agenda.push({ title: `Checkout — Unit ${u.nomor}`, sub: "Hari ini", time: "12:00", dot: "bg-ruby-500" }));
  if (sum && sum.checkin_today > 0) agenda.push({ title: `${sum.checkin_today} check-in terjadwal`, sub: "Siapkan unit", time: "14:00", dot: "bg-azure-500" });
  if (sum && sum.dirty > 0) agenda.push({ title: `${sum.dirty} unit perlu dibersihkan`, sub: "Housekeeping", time: "Segera", dot: "bg-gold-500" });

  return (
    <FrontDeskShell
      pageTitle="Front Desk"
      pageSub={new Date().toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
      topBarExtra={
        <>
          <button onClick={openCheckin} className="text-[11px] bg-gold-500 text-base-950 font-semibold rounded px-3.5 py-2 whitespace-nowrap">
            + Check-In
          </button>
          <button onClick={openCheckout} className="hidden sm:block text-[11px] text-ink/80 bg-base-800 border border-ink/10 rounded px-3.5 py-2 whitespace-nowrap">
            Check-Out
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3.5">
        <StatCard label="Tersedia" value={String(sum?.available ?? "—")} accent="sage" />
        <StatCard label="Terisi" value={String(sum?.occupied ?? "—")} sub="dari 13 unit" accent="gold" />
        <StatCard label="Check-In Hari Ini" value={String(sum?.checkin_today ?? "—")} accent="azure" />
        <StatCard label="Checkout Hari Ini" value={String(sum?.checkout_today ?? "—")} accent="ruby" />
        <StatCard label="Perlu Dibersihkan" value={String(sum?.dirty ?? "—")} accent="ruby" onClick={() => router.push("/front-desk/housekeeping")} />
      </div>

      <div className="grid lg:grid-cols-[2fr_1fr] gap-3.5">
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Peta Unit — 13 Villa" action={<a href="/front-desk/siteplan" className="text-[10.5px] text-gold-500">Siteplan lengkap →</a>} />
            <div className="p-4 sm:p-5">
              {loading ? (
                <Loading />
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {units.map((u) => (
                    <div key={u.id} className={`border rounded px-2.5 py-2 min-w-[52px] text-center ${statusColor[u.status]}`}>
                      <div className="font-serif text-base font-light text-ink">{u.nomor}</div>
                      <div className="text-[8.5px] text-ink/30 mt-0.5">{statusLabel[u.status]}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Notifikasi Terbaru" action={<a href="/front-desk/notifikasi" className="text-[10.5px] text-gold-500">Semua →</a>} />
            {notifs.length === 0 ? (
              <Loading label="Tidak ada notifikasi" />
            ) : (
              notifs.slice(0, 4).map((n) => (
                <div key={n.id} className="flex gap-2.5 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 items-start">
                  <div className="w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0 mt-1.5" />
                  <div>
                    <div className="text-[11.5px] text-ink/50 leading-relaxed">
                      <b className="text-ink">{n.judul}</b> — {n.pesan}
                    </div>
                    <div className="text-[9.5px] text-ink/30 mt-0.5">{fmtDate(n.created_at)}</div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Aksi Cepat" />
            <div className="p-4 grid grid-cols-2 gap-2">
              <button onClick={openCheckin} className="flex flex-col items-center justify-center py-4 rounded bg-gold-500 text-base-950">
                <span className="text-lg">🛎️</span>
                <span className="text-[10.5px] font-semibold mt-1">Check-In</span>
              </button>
              <button onClick={openCheckout} className="flex flex-col items-center justify-center py-4 rounded bg-base-800 border border-ink/10 text-ink/50">
                <span className="text-lg">👋</span>
                <span className="text-[10.5px] font-medium mt-1">Check-Out</span>
              </button>
              <a href="/front-desk/housekeeping" className="flex flex-col items-center justify-center py-4 rounded bg-base-800 border border-ink/10 text-ink/50">
                <span className="text-lg">🧹</span>
                <span className="text-[10.5px] font-medium mt-1">Housekeeping</span>
              </a>
              <a href="/front-desk/booking" className="flex flex-col items-center justify-center py-4 rounded bg-base-800 border border-ink/10 text-ink/50">
                <span className="text-lg">📅</span>
                <span className="text-[10.5px] font-medium mt-1">Booking</span>
              </a>
            </div>
          </Card>
          <Card>
            <CardHeader title="Agenda Hari Ini" />
            {agenda.length === 0 ? (
              <Loading label="Tidak ada agenda khusus" />
            ) : (
              agenda.map((a, i) => (
                <div key={i} className="flex gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0 items-start">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${a.dot}`} />
                  <div className="flex-1">
                    <div className="text-[11.5px] font-medium text-ink/80">{a.title}</div>
                    <div className="text-[10px] text-ink/30">{a.sub}</div>
                  </div>
                  <div className="font-mono text-[9.5px] text-ink/30 pt-0.5 shrink-0">{a.time}</div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={ciOpen}
        title="Check-In Tamu"
        onClose={() => setCiOpen(false)}
        footer={
          <>
            <Btn onClick={() => setCiOpen(false)}>Batal</Btn>
            <Btn variant="primary" onClick={ciTab === "existing" ? doCheckinExisting : doCheckinNew}>
              {ciTab === "new" && ci.src === "walk-in" ? "Lanjut ke Payment Gateway →" : "Proses Check-In"}
            </Btn>
          </>
        }
      >
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setCiTab("existing")}
            className={`flex-1 py-2 rounded-lg text-[11.5px] font-semibold transition ${
              ciTab === "existing" ? "bg-gold-500 text-base-950" : "bg-base-800 text-ink/50 border border-ink/10"
            }`}
          >
            Booking Terjadwal
          </button>
          <button
            onClick={() => setCiTab("new")}
            className={`flex-1 py-2 rounded-lg text-[11.5px] font-semibold transition ${
              ciTab === "new" ? "bg-gold-500 text-base-950" : "bg-base-800 text-ink/50 border border-ink/10"
            }`}
          >
            Tamu Baru
          </button>
        </div>

        {ciTab === "existing" ? (
          <div>
            <div className="text-[10px] text-ink/40 mb-3 leading-relaxed">
              Untuk tamu yang bookingnya sudah ada di sistem (termasuk OTA/Cloudbeds yang masuk otomatis) — sudah dibayar lewat channel-nya, tinggal check-in.
            </div>
            {scheduledBookings.length === 0 ? (
              <div className="text-[11px] text-ink/30 text-center py-6">Tidak ada booking terjadwal. Pakai tab &quot;Tamu Baru&quot; untuk tamu yang belum ada bookingnya.</div>
            ) : (
              <div className="max-h-[280px] overflow-y-auto -mx-1 space-y-1.5">
                {scheduledBookings.map((bk) => (
                  <button
                    key={bk.id}
                    onClick={() => setSelectedBookingId(bk.id)}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition ${
                      selectedBookingId === bk.id ? "border-gold-500 bg-gold-500/10" : "border-ink/10 hover:border-ink/20"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11.5px] font-medium text-ink/80 truncate">{bk.guest_nama}</div>
                      <div className="text-[9.5px] text-ink/30 mt-0.5">
                        Unit {bk.unit_nomor} · {fmtDate(bk.tgl_checkin)} · {bk.sumber === "cloudbeds" ? "☁ Cloudbeds" : bk.sumber}
                      </div>
                    </div>
                    <div className="text-[10.5px] text-ink/50 shrink-0">{fmtCurrencyFull(bk.total_bayar ?? bk.tarif)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <Field label="Sumber Booking">
              <select className={inputCls} value={ci.src} onChange={(e) => setCi({ ...ci, src: e.target.value })}>
                <option value="walk-in">Walk-in (bayar sekarang via QRIS)</option>
                <option value="airbnb">Airbnb</option>
                <option value="tiket">Tiket.com</option>
                <option value="agoda">Agoda</option>
                <option value="website">Website Loonars</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </Field>
            {ci.src === "walk-in" ? (
              <div className="text-[10px] text-ink/40 mb-1 leading-relaxed">
                Tamu walk-in dibuatkan bookingnya dan ditagih via QRIS dulu di Payment Gateway — data check-in baru masuk setelah pembayaran dikonfirmasi lunas.
              </div>
            ) : (
              <>
                <Field label="Nama Tamu"><input className={inputCls} value={ci.nama} onChange={(e) => setCi({ ...ci, nama: e.target.value })} placeholder="Nama lengkap" /></Field>
                <Field label="No. KTP / Paspor"><input className={inputCls} value={ci.ktp} onChange={(e) => setCi({ ...ci, ktp: e.target.value })} placeholder="Nomor identitas" /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={`Unit${availLoading ? " — mengecek ketersediaan…" : ""}`}>
                    <select className={inputCls} value={ci.unit_id} onChange={(e) => setCi({ ...ci, unit_id: e.target.value })}>
                      <option value="">Pilih unit</option>
                      {(availUnits ?? units.map((u) => ({ ...u, tersedia_untuk_tanggal: u.status === "available", dibooking_oleh: null }))).map((u) => (
                        <option key={u.id} value={u.id} disabled={!u.tersedia_untuk_tanggal}>
                          Unit {u.nomor}{!u.tersedia_untuk_tanggal ? ` — dibooking (${u.dibooking_oleh ?? u.status})` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tipe">
                    <select className={inputCls} value={ci.tipe} onChange={(e) => setCi({ ...ci, tipe: e.target.value })}>
                      <option value="harian">Harian</option>
                      <option value="bulanan">Bulanan</option>
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Check-in"><input type="date" className={inputCls} value={ci.checkin} onChange={(e) => setCi({ ...ci, checkin: e.target.value })} /></Field>
                  <Field label="Check-out"><input type="date" className={inputCls} value={ci.checkout} onChange={(e) => setCi({ ...ci, checkout: e.target.value })} /></Field>
                </div>
                <Field label="No. HP Tamu"><input className={inputCls} value={ci.hp} onChange={(e) => setCi({ ...ci, hp: e.target.value })} placeholder="+62 8xx-xxxx-xxxx" /></Field>
                <Field label="Tarif (Rp) — sesuai harga dari channel ini">
                  <input type="number" className={inputCls} value={ci.tarif} onChange={(e) => setCi({ ...ci, tarif: e.target.value })} placeholder="0" />
                </Field>
              </>
            )}
          </>
        )}
      </Modal>

      <Modal open={coOpen} title="Check-Out Tamu" onClose={() => setCoOpen(false)} footer={<><Btn onClick={() => setCoOpen(false)}>Batal</Btn><Btn variant="primary" onClick={doCheckout}>Proses Check-Out</Btn></>}>
        <Field label="Pilih Unit">
          <select className={inputCls} value={coUnitId} onChange={(e) => setCoUnitId(e.target.value)}>
            {occupiedUnits.length === 0 && <option value="">Tidak ada unit terisi</option>}
            {occupiedUnits.map((u) => (
              <option key={u.id} value={u.id}>Unit {u.nomor} ({u.status})</option>
            ))}
          </select>
        </Field>
        <Field label="Kondisi Unit">
          <select className={inputCls} value={coCond} onChange={(e) => setCoCond(e.target.value)}>
            <option>Baik — tidak ada kerusakan</option>
            <option>Ada kerusakan minor</option>
            <option>Ada kerusakan signifikan</option>
          </select>
        </Field>
        <Field label="Catatan"><input className={inputCls} value={coNote} onChange={(e) => setCoNote(e.target.value)} placeholder="Opsional..." /></Field>
      </Modal>
    </FrontDeskShell>
  );
}
