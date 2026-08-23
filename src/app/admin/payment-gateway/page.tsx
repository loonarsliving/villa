"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { StatCard } from "@/components/StatCard";
import type { WalkinKategori, WalkinPayment, WalkinStatus } from "@/lib/types";
import { loadQrisImage, saveQrisImage, clearQrisImage } from "@/lib/walkin";
import { isSuperAdminEmail, getVerifiedFlag, setVerifiedFlag } from "@/lib/superAdmin";

const kategoriLabel: Record<WalkinKategori, string> = { cafe: "Cafe", spa: "Spa", lainnya: "Lainnya" };
const kategoriIcon: Record<WalkinKategori, string> = { cafe: "☕", spa: "💆", lainnya: "◍" };
const statusTone: Record<WalkinStatus, "ok" | "pending" | "danger"> = { pending: "pending", lunas: "ok", batal: "danger" };
const statusLabel: Record<WalkinStatus, string> = { pending: "Menunggu Bayar", lunas: "Lunas", batal: "Dibatalkan" };
const amountPresets = [25000, 50000, 100000, 150000, 250000];

function AccessGate({ onVerified }: { onVerified: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");

  function verify() {
    if (!email.trim()) {
      toast("⚠", "Lengkapi form", "Masukkan email akun Anda.", "ruby");
      return;
    }
    if (!isSuperAdminEmail(email)) {
      toast("⛔", "Akses ditolak", "Email ini tidak terdaftar sebagai super admin untuk modul Payment Gateway.", "ruby");
      return;
    }
    setVerifiedFlag();
    toast("✓", "Akses diverifikasi", "Selamat datang di modul Payment Gateway.", "sage");
    onVerified();
  }

  return (
    <div className="max-w-md mx-auto mt-6 sm:mt-12">
      <Card>
        <CardHeader title="Verifikasi Akses" subtitle="Modul ini khusus super admin" />
        <CardBody>
          <div className="text-5xl text-center mb-4">🔐</div>
          <p className="text-xs text-ink/50 leading-relaxed mb-5 text-center">
            Payment Gateway menyimpan data transaksi tamu walk-in. Masukkan email akun super admin Anda untuk melanjutkan.
          </p>
          <Field label="Email Akun">
            <input
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="nama@email.com"
              autoFocus
            />
          </Field>
          <button onClick={verify} className="w-full mt-2 bg-gold-500 text-base-950 rounded-lg py-2.5 text-[12px] font-semibold tracking-wide hover:opacity-90 transition">
            Verifikasi &amp; Lanjutkan
          </button>
        </CardBody>
      </Card>
    </div>
  );
}

export default function PaymentGatewayPage() {
  const toast = useToast();
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);
  const [rows, setRows] = useState<WalkinPayment[]>([]);
  const [qris, setQris] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activePayment, setActivePayment] = useState<WalkinPayment | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | WalkinStatus>("all");

  const [form, setForm] = useState({
    guest_nama: "",
    guest_hp: "",
    kategori: "cafe" as WalkinKategori,
    deskripsi: "",
    jumlah: "" as string,
  });

  function load() {
    api
      .get<WalkinPayment[]>("/admin/walkin-payments")
      .then((r) => setRows(r || []))
      .catch((e) => toast("⚠", "Gagal memuat", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby"));
  }

  useEffect(() => {
    const ok = getVerifiedFlag();
    setVerified(ok);
    setChecking(false);
    if (ok) {
      load();
      loadQrisImage()
        .then(setQris)
        .catch((e) => toast("⚠", "Gagal memuat QRIS", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRows = useMemo(
    () => (filterStatus === "all" ? rows : rows.filter((r) => r.status === filterStatus)),
    [rows, filterStatus]
  );

  const todayStr = new Date().toDateString();
  const todayRows = rows.filter((r) => new Date(r.created_at).toDateString() === todayStr);
  const todayLunas = todayRows.filter((r) => r.status === "lunas");
  const totalHariIni = todayLunas.reduce((s, r) => s + r.jumlah, 0);
  const pendingCount = rows.filter((r) => r.status === "pending").length;
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

  async function createPayment() {
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
      const payment = await api.post<WalkinPayment>("/admin/walkin-payments", {
        guest_nama: form.guest_nama.trim(),
        guest_hp: form.guest_hp.trim() || null,
        kategori: form.kategori,
        deskripsi: form.deskripsi.trim() || kategoriLabel[form.kategori],
        jumlah: jumlahNum,
      });
      setRows((prev) => [payment, ...prev]);
      setActivePayment(payment);
      setForm({ guest_nama: "", guest_hp: "", kategori: form.kategori, deskripsi: "", jumlah: "" });
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function setStatus(id: string, status: WalkinStatus) {
    try {
      const updated = await api.patch<WalkinPayment>("/admin/walkin-payments", { id, status });
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setActivePayment((cur) => (cur && cur.id === id ? updated : cur));
      if (status === "lunas") toast("✓", "Pembayaran lunas", "Transaksi walk-in berhasil dicatat sebagai lunas.", "sage");
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  if (checking) {
    return (
      <AdminShell pageTitle="Payment Gateway">
        <Loading />
      </AdminShell>
    );
  }

  if (!verified) {
    return (
      <AdminShell pageTitle="Payment Gateway" pageSub="Akses terbatas — super admin">
        <AccessGate
          onVerified={() => {
            setVerified(true);
            load();
          }}
        />
      </AdminShell>
    );
  }

  return (
    <AdminShell pageTitle="Payment Gateway" pageSub="Kasir walk-in — Cafe & Spa">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Pemasukan Hari Ini" value={fmtCurrencyFull(totalHariIni)} sub={`${todayLunas.length} transaksi lunas`} accent="sage" icon="✓" />
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
                  {(Object.keys(kategoriLabel) as WalkinKategori[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => setForm({ ...form, kategori: k })}
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
              <button onClick={createPayment} className="w-full mt-1 bg-gold-500 text-base-950 rounded-lg py-3 text-[12.5px] font-semibold tracking-wide hover:opacity-90 active:scale-[0.99] transition">
                Buat QRIS Pembayaran
              </button>
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Riwayat Transaksi"
              subtitle={`${filteredRows.length} transaksi`}
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
                    onClick={() => setActivePayment(r)}
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
        title="QRIS Pembayaran"
        onClose={() => setActivePayment(null)}
        footer={
          activePayment && activePayment.status === "pending" ? (
            <>
              <Btn onClick={() => activePayment && setStatus(activePayment.id, "batal")}>Batalkan</Btn>
              <Btn variant="primary" onClick={() => activePayment && setStatus(activePayment.id, "lunas")}>
                Tandai Lunas
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
    </AdminShell>
  );
}
