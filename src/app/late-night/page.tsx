"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { Card, CardHeader, CardBody, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, fmtDate, fmtTime } from "@/lib/format";
import type { LateNightBooking, LateNightHariIni, LateNightUnit } from "@/lib/types";

/**
 * Late night booking -- satu-satunya modul role late_night (Laila),
 * cadangan di aplikasi villa. Halaman utama Laila ada di loonars.id/late
 * (repo loonars), yang memanggil rute villa-api yang sama.
 *
 * Alurnya (keputusan owner 2026-10-03):
 *   1. pilih unit Standard yang kosong & bersih malam ini, isi nama + WA tamu;
 *   2. tamu memindai QRIS statis villa dan mengetik sendiri Rp260.000;
 *   3. Laila mengecek uangnya masuk, lalu menekan Lunas -- itu sekaligus
 *      check-in: PIN pintu dikirim ke WA tamu dan pemasukan tercatat.
 * Booking hanya bisa dibuat pukul 01.00-09.00 WIB; yang tidak ditandai
 * Lunas dalam 30 menit dibatalkan otomatis (dicek villa-api).
 */
export default function LateNightPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<LateNightHariIni | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pilih, setPilih] = useState<LateNightUnit | null>(null);
  const [bayar, setBayar] = useState<LateNightBooking | null>(null);

  const muat = useCallback(async () => {
    try {
      setData(await api.get<LateNightHariIni>("/late-night/hari-ini"));
      setGalat(null);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat data");
    }
  }, []);

  useEffect(() => {
    muat();
    const t = setInterval(muat, 60_000);
    return () => clearInterval(t);
  }, [muat]);

  const tersedia = data?.unit.filter((u) => u.tersedia) ?? [];
  const menunggu = data?.booking.filter((b) => b.status === "terjadwal") ?? [];
  const jam = (n: number) => `${String(n).padStart(2, "0")}.00`;

  return (
    <DashboardShell
      brandTitle="Late Night"
      brandSub="Loonars Private Living"
      roleLabel={user?.role === "admin" ? "Admin" : "Late Night"}
      sections={[
        { title: "Late Night", items: [{ href: "/late-night", label: "Booking Late Night", icon: "☾" }] },
        ...(user?.role === "admin" ? [{ title: "Admin", items: [{ href: "/admin", label: "Panel Admin", icon: "◈" }] }] : []),
      ]}
      pageTitle="Booking Late Night"
      pageSub={data ? `Masuk ${jam(data.jam_mulai)} – keluar ${jam(data.jam_selesai)} WIB · ${fmtCurrencyFull(data.tarif)}` : undefined}
    >
      {galat && <div className="mb-4 rounded-xl border border-ruby-500/30 bg-ruby-500/10 px-4 py-3 text-[12px] text-ruby-400">{galat}</div>}
      {!data && !galat ? (
        <Loading />
      ) : data ? (
        <>
          <div
            className={`mb-4 rounded-xl border px-4 py-3 text-[12px] ${
              data.jendela_buka ? "border-sage-500/30 bg-sage-500/10 text-sage-500" : "border-gold-500/30 bg-gold-500/10 text-gold-500"
            }`}
          >
            {data.jendela_buka
              ? `Booking dibuka sekarang. Malam ${fmtDate(data.malam)}, tamu keluar ${fmtDate(data.checkout)} pukul ${jam(data.jam_selesai)} WIB.`
              : `Booking late night hanya bisa dibuat pukul ${jam(data.jam_mulai)}–${jam(data.jam_selesai)} WIB.`}
          </div>

          {menunggu.length > 0 && (
            <Card className="mb-4">
              <CardHeader title="Menunggu Pembayaran" subtitle={`Batal otomatis jika tidak ditandai Lunas dalam ${data.hold_menit} menit`} />
              {menunggu.map((b) => (
                <div key={b.id} className="px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">Unit {b.unit_nomor} · {b.guest_nama}</div>
                    <div className="text-[10.5px] text-ink/40">Dibuat {fmtTime(b.created_at)} · {fmtCurrencyFull(b.total_bayar)}</div>
                  </div>
                  <Btn variant="primary" onClick={() => setBayar(b)}>QRIS & Lunas</Btn>
                </div>
              ))}
            </Card>
          )}

          <Card className="mb-4">
            <CardHeader title="Unit Standard" subtitle={`${tersedia.length} dari ${data.unit.length} bisa dijual`} />
            {data.unit.length === 0 ? (
              <Empty label="Tidak ada unit Standard" />
            ) : (
              data.unit.map((u) => (
                <div key={u.id} className="px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">Unit {u.nomor}</div>
                    <div className="text-[10.5px] text-ink/40">{u.tersedia ? "Kosong & bersih" : u.alasan}</div>
                  </div>
                  {u.tersedia ? (
                    <Btn variant="primary" disabled={!data.jendela_buka} onClick={() => setPilih(u)}>Booking</Btn>
                  ) : (
                    <Badge tone="danger">Tidak tersedia</Badge>
                  )}
                </div>
              ))
            )}
          </Card>

          <Card>
            <CardHeader title="Riwayat 7 Hari" />
            {data.booking.length === 0 ? (
              <Empty label="Belum ada booking late night" />
            ) : (
              data.booking.map((b) => <BarisRiwayat key={b.id} b={b} onBerubah={muat} />)
            )}
          </Card>
        </>
      ) : null}

      {pilih && data && (
        <ModalBooking
          unit={pilih}
          tarif={data.tarif}
          onClose={() => setPilih(null)}
          onDibuat={(b) => {
            setPilih(null);
            setBayar(b);
            muat();
          }}
        />
      )}
      {bayar && (
        <ModalBayar
          booking={bayar}
          onClose={() => {
            setBayar(null);
            muat();
          }}
          onLunas={(pin, waTerkirim) => {
            setBayar(null);
            toast("✓", "Lunas — tamu sudah check-in", waTerkirim ? `PIN ${pin} terkirim ke WhatsApp tamu.` : `WA gagal terkirim. Sampaikan PIN ${pin} langsung ke tamu.`, waTerkirim ? "sage" : "gold");
            muat();
          }}
        />
      )}
    </DashboardShell>
  );
}

function ModalBooking({
  unit,
  tarif,
  onClose,
  onDibuat,
}: {
  unit: LateNightUnit;
  tarif: number;
  onClose: () => void;
  onDibuat: (b: LateNightBooking) => void;
}) {
  const [nama, setNama] = useState("");
  const [hp, setHp] = useState("");
  const [adults, setAdults] = useState("1");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function simpan() {
    setSibuk(true);
    setGalat(null);
    try {
      const b = await api.post<LateNightBooking>("/late-night/bookings", { unit_id: unit.id, nama, hp, adults: Number(adults) });
      onDibuat(b);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal membuat booking");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <Modal
      open
      title={`Booking Unit ${unit.nomor}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Batal</Btn>
          <Btn variant="primary" disabled={sibuk} onClick={simpan}>{sibuk ? "Menyimpan..." : "Lanjut ke QRIS"}</Btn>
        </>
      }
    >
      <Field label="Nama tamu"><input className={inputCls} value={nama} onChange={(e) => setNama(e.target.value)} /></Field>
      <Field label="WhatsApp tamu (untuk PIN pintu)"><input className={inputCls} inputMode="tel" placeholder="08..." value={hp} onChange={(e) => setHp(e.target.value)} /></Field>
      <Field label="Jumlah tamu"><input className={inputCls} type="number" min={1} max={20} value={adults} onChange={(e) => setAdults(e.target.value)} /></Field>
      <div className="text-[12px] text-ink/60">Tarif: <span className="text-ink font-semibold">{fmtCurrencyFull(tarif)}</span></div>
      {galat && <div className="mt-3 text-[12px] text-ruby-400">{galat}</div>}
    </Modal>
  );
}

function ModalBayar({
  booking,
  onClose,
  onLunas,
}: {
  booking: LateNightBooking;
  onClose: () => void;
  onLunas: (pin: string, waTerkirim: boolean) => void;
}) {
  const [qris, setQris] = useState<string | null | undefined>(undefined);
  const [yakin, setYakin] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data_url: string | null }>("/late-night/qris")
      .then((r) => setQris(r.data_url))
      .catch(() => setQris(null));
  }, []);

  async function lunas() {
    setSibuk(true);
    setGalat(null);
    try {
      const r = await api.post<{ pin_kode: string; wa_terkirim: boolean }>("/late-night/lunas", { booking_id: booking.id });
      onLunas(r.pin_kode, r.wa_terkirim);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal menandai lunas");
      setSibuk(false);
    }
  }

  async function batal() {
    setSibuk(true);
    try {
      await api.post("/late-night/batal", { booking_id: booking.id });
      onClose();
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal membatalkan");
      setSibuk(false);
    }
  }

  return (
    <Modal
      open
      title={`QRIS — Unit ${booking.unit_nomor}`}
      onClose={onClose}
      footer={
        <>
          <Btn disabled={sibuk} onClick={batal}>Batalkan Booking</Btn>
          <Btn variant="primary" disabled={sibuk || !yakin} onClick={lunas}>{sibuk ? "Memproses..." : "Tandai Lunas"}</Btn>
        </>
      }
    >
      <div className="text-center">
        {qris === undefined ? (
          <Loading />
        ) : qris ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qris} alt="QRIS Loonars" className="w-64 mx-auto rounded-lg bg-white p-2" />
        ) : (
          <div className="rounded-xl border border-ruby-500/30 bg-ruby-500/10 px-4 py-3 text-[12px] text-ruby-400">
            Gambar QRIS belum diunggah. Minta admin/resepsionis mengunggahnya di Payment Gateway (⚙ QRIS).
          </div>
        )}
        <div className="mt-3 text-[10px] uppercase tracking-wide text-ink/40">Nominal yang harus diketik tamu</div>
        <div className="font-serif text-3xl text-ink">{fmtCurrencyFull(booking.total_bayar)}</div>
        <div className="mt-1 text-[11px] text-ink/40">{booking.guest_nama}</div>
      </div>
      <ol className="mt-4 text-[11.5px] text-ink/60 list-decimal pl-5 space-y-1">
        <li>Tamu memindai QRIS dan mengetik sendiri {fmtCurrencyFull(booking.total_bayar)}.</li>
        <li>Cek uangnya benar-benar masuk (notifikasi/mutasi rekening villa). Tidak ada konfirmasi otomatis.</li>
        <li>Tekan Tandai Lunas: tamu langsung check-in dan PIN pintu dikirim ke WhatsApp tamu.</li>
      </ol>
      <label className="mt-4 flex items-start gap-2 text-[12px] text-ink/70">
        <input type="checkbox" className="mt-0.5" checked={yakin} onChange={(e) => setYakin(e.target.checked)} />
        Saya sudah melihat pembayaran {fmtCurrencyFull(booking.total_bayar)} masuk.
      </label>
      {galat && <div className="mt-3 text-[12px] text-ruby-400">{galat}</div>}
    </Modal>
  );
}

const LABEL_STATUS: Record<LateNightBooking["status"], { label: string; tone: "ok" | "pending" | "danger" }> = {
  terjadwal: { label: "Menunggu bayar", tone: "pending" },
  checkin: { label: "Menginap", tone: "ok" },
  checkout: { label: "Selesai", tone: "ok" },
  batal: { label: "Batal", tone: "danger" },
};

function BarisRiwayat({ b, onBerubah }: { b: LateNightBooking; onBerubah: () => void }) {
  const toast = useToast();
  const [sibuk, setSibuk] = useState(false);
  const s = LABEL_STATUS[b.status] ?? { label: b.status, tone: "pending" as const };

  async function checkout() {
    if (!confirm(`Tandai ${b.guest_nama} (Unit ${b.unit_nomor}) sudah keluar?`)) return;
    setSibuk(true);
    try {
      await api.post("/late-night/checkout", { booking_id: b.id });
      toast("✓", "Checkout", `Unit ${b.unit_nomor} dijadwalkan dibersihkan.`, "sage");
      onBerubah();
    } catch (e) {
      toast("!", "Gagal checkout", e instanceof Error ? e.message : "Gagal", "ruby");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] text-ink">Unit {b.unit_nomor} · {b.guest_nama}</div>
        <div className="text-[10.5px] text-ink/40">
          {fmtDate(b.tgl_checkout)} · {fmtCurrencyFull(b.total_bayar)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge tone={s.tone}>{s.label}</Badge>
        {b.status === "checkin" && <Btn disabled={sibuk} onClick={checkout}>Checkout</Btn>}
      </div>
    </div>
  );
}
