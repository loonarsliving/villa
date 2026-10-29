"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ExcellentShell } from "../../_shell";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Btn } from "@/components/Modal";
import { pdfFirstPageToPngDataUrl } from "@/lib/pdfToImage";
import type { ElBooking } from "@/lib/types";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca berkas"));
    reader.readAsDataURL(file);
  });
}

function pesanError(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : "Terjadi kesalahan.";
}

/**
 * Payment Gateway Loonars Excellent Living. Memakai QRIS statis EL sendiri
 * (integration_settings 'el_qris'), terpisah dari QRIS Private Living.
 * QRIS statis tidak membawa nominal dan tidak ada konfirmasi otomatis:
 * resepsionis mencocokkan mutasi rekening, lalu klik "Tandai Lunas".
 */
export default function ElPaymentGatewayPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const [qris, setQris] = useState<string | null | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);
  const [bookings, setBookings] = useState<ElBooking[] | null>(null);
  const [tagih, setTagih] = useState<ElBooking | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get<ElBooking[]>("/el/bookings").then(setBookings).catch(() => setBookings([]));
  }
  useEffect(() => {
    load();
    api
      .get<{ data_url: string | null }>("/el/qris")
      .then((r) => setQris(r?.data_url ?? null))
      .catch((e) => {
        setQris(null);
        toast("⚠", "Gagal memuat QRIS", pesanError(e), "ruby");
      });
  }, [toast]);

  const menunggu = useMemo(
    () => (bookings ?? []).filter((b) => b.status !== "batal" && b.status_bayar !== "lunas"),
    [bookings],
  );
  const lunas = useMemo(
    () =>
      (bookings ?? [])
        .filter((b) => b.status_bayar === "lunas")
        .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? "")),
    [bookings],
  );

  async function onUploadQris(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast("⚠", "Berkas terlalu besar", "Ukuran berkas asli maksimal 8MB sebelum dikonversi.", "ruby");
      e.target.value = "";
      return;
    }
    try {
      // PDF lembar QRIS dari bank dirender jadi PNG dulu (sama dengan Private Living).
      const dataUrl =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? await pdfFirstPageToPngDataUrl(file)
          : await readFileAsDataUrl(file);
      if (dataUrl.length > 1.5 * 1024 * 1024 * 1.4) {
        toast("⚠", "Gambar terlalu besar", "Ukuran maksimal 1.5MB setelah dikonversi — kompres/perkecil dulu.", "ruby");
        return;
      }
      await api.post("/el/qris", { data_url: dataUrl });
      setQris(dataUrl);
      toast("✓", "QRIS disimpan", "QRIS Excellent Living berhasil diunggah.", "sage");
    } catch (err) {
      toast("⚠", "Gagal menyimpan QRIS", pesanError(err), "ruby");
    } finally {
      e.target.value = "";
    }
  }

  async function hapusQris() {
    if (!confirm("Hapus gambar QRIS Excellent Living?")) return;
    try {
      await api.post("/el/qris", { data_url: null });
      setQris(null);
    } catch (e) {
      toast("⚠", "Gagal menghapus QRIS", pesanError(e), "ruby");
    }
  }

  async function tandaiLunas() {
    if (!tagih || busy) return;
    if (!confirm(`Sudah cek mutasi rekening dan dana ${fmtCurrencyFull(tagih.total_bayar)} dari ${tagih.guest_nama} benar-benar masuk?`)) return;
    setBusy(true);
    try {
      await api.patch("/el/bookings", { id: tagih.id, action: "lunas" });
      toast("✓", "Lunas", `${tagih.guest_nama} — ${fmtCurrencyFull(tagih.total_bayar)}`, "sage");
      setTagih(null);
      load();
    } catch (e) {
      toast("⚠", "Gagal", pesanError(e), "ruby");
    } finally {
      setBusy(false);
    }
  }

  async function batalLunas(b: ElBooking) {
    if (!confirm(`Batalkan status lunas ${b.guest_nama}? Booking kembali ke daftar menunggu pembayaran.`)) return;
    setBusy(true);
    try {
      await api.patch("/el/bookings", { id: b.id, action: "batal_lunas" });
      toast("✓", "Status lunas dibatalkan", b.guest_nama, "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", pesanError(e), "ruby");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ExcellentShell pageTitle="Payment Gateway" pageSub="Loonars Excellent Living">
      <Card>
        <CardHeader
          title="QRIS Excellent Living"
          subtitle="Tunjukkan ke tamu untuk dipindai"
          action={<Btn onClick={() => setShowSettings((v) => !v)}>{showSettings ? "Tutup" : "⚙ QRIS"}</Btn>}
        />
        <CardBody>
          {qris === undefined ? (
            <Loading />
          ) : qris ? (
            <img src={qris} alt="QRIS Loonars Excellent Living" className="w-full max-w-[260px] mx-auto rounded-lg border border-ink/10" />
          ) : (
            <div className="rounded-lg border border-ruby-400/30 bg-ruby-400/10 p-3 text-[12px] text-ruby-400">
              <b>QRIS Excellent Living belum diunggah.</b> Tamu tidak punya kode untuk dipindai — unggah lewat ⚙ QRIS.
            </div>
          )}
          {showSettings && (
            <div className="mt-4 rounded-lg border border-ink/10 p-3 text-[11.5px] text-ink/60">
              QRIS statis milik Excellent Living (gambar, atau PDF lembar QRIS dari bank — otomatis dikonversi jadi gambar).
              Terpisah dari QRIS Private Living. Karena QRIS statis tidak membawa nominal, tamu mengetik sendiri jumlahnya
              dan resepsionis yang memastikan dana masuk sebelum menandai lunas.
              <div className="mt-3 flex items-center gap-3">
                <label className="cursor-pointer text-[11px] font-semibold text-gold-600">
                  {qris ? "Ganti gambar" : "Unggah gambar / PDF"}
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onUploadQris} />
                </label>
                {qris && (
                  <button type="button" onClick={hapusQris} className="text-[11px] font-semibold text-ruby-400">
                    Hapus
                  </button>
                )}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Menunggu Pembayaran" subtitle="Booking EL yang belum lunas" />
        {!bookings ? (
          <Loading />
        ) : menunggu.length === 0 ? (
          <Empty label="Tidak ada booking yang menunggu pembayaran" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[9.5px] uppercase tracking-wider text-ink/30">
                  <th className="px-3.5 py-2.5">Kamar</th>
                  <th className="px-3.5 py-2.5">Tamu</th>
                  <th className="px-3.5 py-2.5">Tanggal</th>
                  <th className="px-3.5 py-2.5 text-right">Total</th>
                  <th className="px-3.5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {menunggu.map((b) => (
                  <tr key={b.id} className="border-t border-ink/[0.05]">
                    <td className="px-3.5 py-2.5 font-semibold text-ink">{b.room_nomor ?? "—"}</td>
                    <td className="px-3.5 py-2.5 text-ink/70">
                      {b.guest_nama}
                      {b.guest_hp && <div className="text-[10.5px] text-ink/35">{b.guest_hp}</div>}
                    </td>
                    <td className="px-3.5 py-2.5 text-ink/60 whitespace-nowrap">{b.tgl_checkin} → {b.tgl_checkout}</td>
                    <td className="px-3.5 py-2.5 text-right text-ink/70 whitespace-nowrap">
                      {b.total_bayar > 0 ? fmtCurrencyFull(b.total_bayar) : <span className="text-ruby-400">Belum diisi</span>}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      <Btn variant="primary" disabled={busy} onClick={() => setTagih(b)}>Tagih</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Sudah Lunas" subtitle="Mulai 7 hari terakhir" />
        {!bookings ? (
          <Loading />
        ) : lunas.length === 0 ? (
          <Empty label="Belum ada pembayaran lunas" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[9.5px] uppercase tracking-wider text-ink/30">
                  <th className="px-3.5 py-2.5">Kamar</th>
                  <th className="px-3.5 py-2.5">Tamu</th>
                  <th className="px-3.5 py-2.5 text-right">Total</th>
                  <th className="px-3.5 py-2.5">Lunas</th>
                  <th className="px-3.5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {lunas.map((b) => (
                  <tr key={b.id} className="border-t border-ink/[0.05]">
                    <td className="px-3.5 py-2.5 font-semibold text-ink">{b.room_nomor ?? "—"}</td>
                    <td className="px-3.5 py-2.5 text-ink/70">{b.guest_nama}</td>
                    <td className="px-3.5 py-2.5 text-right text-ink/70 whitespace-nowrap">{fmtCurrencyFull(b.total_bayar)}</td>
                    <td className="px-3.5 py-2.5 text-ink/60">
                      <Badge tone="ok">Lunas</Badge>
                      <div className="text-[10.5px] text-ink/35">
                        {b.paid_at ? fmtDateTime(b.paid_at) : ""}
                        {b.paid_by ? ` · ${b.paid_by}` : ""}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      {isAdmin && <Btn disabled={busy} onClick={() => batalLunas(b)}>Batalkan Lunas</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!tagih}
        title="Tagih via QRIS"
        onClose={() => setTagih(null)}
        footer={
          <>
            <Btn onClick={() => setTagih(null)}>Tutup</Btn>
            <Btn variant="primary" disabled={busy || !tagih || !(tagih.total_bayar > 0)} onClick={tandaiLunas}>Tandai Lunas</Btn>
          </>
        }
      >
        {tagih && (
          <div className="text-center">
            <div className="text-[12px] text-ink/60">
              {tagih.guest_nama} · Kamar {tagih.room_nomor ?? "—"} · {tagih.tgl_checkin} → {tagih.tgl_checkout}
            </div>
            {tagih.total_bayar > 0 ? (
              <div className="my-3 text-[28px] font-bold text-ink">{fmtCurrencyFull(tagih.total_bayar)}</div>
            ) : (
              <div className="my-3 text-[12px] text-ruby-400">Total bayar masih 0 — isi dulu lewat Ubah di halaman Booking.</div>
            )}
            {qris ? (
              <img src={qris} alt="QRIS Loonars Excellent Living" className="w-full max-w-[260px] mx-auto rounded-lg border border-ink/10" />
            ) : (
              <div className="text-[12px] text-ruby-400">QRIS Excellent Living belum diunggah.</div>
            )}
            <ol className="mt-4 text-left text-[11.5px] text-ink/60 list-decimal pl-5 space-y-1">
              <li>Tamu memindai QRIS dan mengetik sendiri nominal di atas, persis.</li>
              <li>Cek notifikasi/mutasi rekening Excellent Living sampai dana benar-benar masuk.</li>
              <li>Baru klik <b>Tandai Lunas</b>.</li>
            </ol>
          </div>
        )}
      </Modal>
    </ExcellentShell>
  );
}
