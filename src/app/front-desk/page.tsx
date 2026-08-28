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
import { CheckinCard, type CheckinCardGuest } from "@/components/CheckinCard";
import type { Booking, Summary, Unit, Notification } from "@/lib/types";

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

  const [ciTab, setCiTab] = useState<"existing" | "new">("existing");
  const [scheduledBookings, setScheduledBookings] = useState<Booking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [coUnitId, setCoUnitId] = useState("");
  const [coCond, setCoCond] = useState("Baik — tidak ada kerusakan");
  const [coNote, setCoNote] = useState("");
  const [checkinCardOpen, setCheckinCardOpen] = useState(false);
  const [pendingCheckin, setPendingCheckin] = useState<{
    booking_id: string;
    unit_id: string;
    unit_nomor: string;
    guest_nama: string;
    guest_hp?: string | null;
    tipe: string;
    total_bayar: number;
    checkinDate: string;
    checkoutDate: string | null;
  } | null>(null);

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

  function openCheckin() {
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
    setPendingCheckin({
      booking_id: bk.id,
      unit_id: bk.unit_id,
      unit_nomor: bk.unit_nomor,
      guest_nama: bk.guest_nama,
      guest_hp: bk.guest_hp,
      tipe: bk.tipe,
      total_bayar: bk.total_bayar ?? bk.tarif,
      checkinDate: bk.tgl_checkin,
      checkoutDate: bk.tgl_checkout,
    });
    setCiOpen(false);
    setCheckinCardOpen(true);
  }

  async function finalizeCheckin(data: { ktpPhotoPath: string; signatureDataUrl: string }) {
    if (!pendingCheckin) return;
    try {
      await api.post("/checkin", {
        booking_id: pendingCheckin.booking_id,
        unit_id: pendingCheckin.unit_id,
        unit_nomor: pendingCheckin.unit_nomor,
        guest_nama: pendingCheckin.guest_nama,
        guest_hp: pendingCheckin.guest_hp,
        tipe: pendingCheckin.tipe,
        total_bayar: pendingCheckin.total_bayar,
        checkin_by: user?.nama || "Staff",
        ktp_photo_path: data.ktpPhotoPath,
        signature_data_url: data.signatureDataUrl,
      });
      toast("🛎️", "Check-In Berhasil", `${pendingCheckin.guest_nama} — Unit ${pendingCheckin.unit_nomor} sudah check-in.`, "sage");
      setTimeout(() => toast("📱", "Investor Unit Diberitahu", `Notifikasi terkirim ke dashboard investor Unit ${pendingCheckin.unit_nomor}.`, "gold"), 1000);
      setCheckinCardOpen(false);
      setPendingCheckin(null);
      load();
    } catch (e) {
      toast("⚠", "Check-In Gagal", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  // A guest with no booking in the system yet is always walk-in -- no
  // source picker anymore, per owner instruction (removed the manual
  // log-a-booking-from-another-channel path entirely). Walk-in must be
  // paid via QRIS, and KTP photo + digital signature must be captured
  // before payment -- both handled entirely by Payment Gateway, so we
  // just hand off there instead of duplicating that flow here.
  function doCheckinNew() {
    setCiOpen(false);
    router.push("/front-desk/payment-gateway?kategori=villa");
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
              {ciTab === "new" ? "Lanjut ke Payment Gateway →" : "Proses Check-In"}
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
          <div className="text-center py-8">
            <div className="text-2xl mb-2">🏡</div>
            <div className="text-[12px] text-ink/70 font-medium mb-1.5">Tamu Baru = Walk-in</div>
            <div className="text-[10.5px] text-ink/40 leading-relaxed max-w-[280px] mx-auto">
              Lanjut ke Payment Gateway untuk isi data tamu &amp; pilih unit. Di sana tamu foto KTP dan tanda tangan digital dulu, baru lanjut bayar via
              QRIS — data check-in baru masuk setelah pembayaran dikonfirmasi lunas.
            </div>
          </div>
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

      <CheckinCard
        open={checkinCardOpen}
        guest={
          pendingCheckin
            ? ({
                guestName: pendingCheckin.guest_nama,
                unitNomor: pendingCheckin.unit_nomor,
                tipe: pendingCheckin.tipe,
                checkinDate: pendingCheckin.checkinDate,
                checkoutDate: pendingCheckin.checkoutDate,
              } satisfies CheckinCardGuest)
            : null
        }
        onClose={() => {
          setCheckinCardOpen(false);
          setPendingCheckin(null);
        }}
        onConfirm={finalizeCheckin}
      />
    </FrontDeskShell>
  );
}
