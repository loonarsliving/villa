"use client";

import { useEffect, useState } from "react";
import { Modal, Btn } from "./Modal";
import { localApi, ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge } from "./Card";

interface DokumenResponse {
  booking: {
    id: string;
    guest_nama: string;
    unit_nomor: string | null;
    tipe: string | null;
    sumber: string | null;
    status: string;
    tgl_checkin: string;
    tgl_checkout: string | null;
    checkin_at: string | null;
    checkin_by: string | null;
  };
  ktpUrl: string | null;
  ktpError: string | null;
  signatureDataUrl: string | null;
}

const statusLabel: Record<string, string> = {
  terjadwal: "Menunggu Check-In",
  checkin: "Sudah Check-In",
  checkout: "Selesai",
  batal: "Dibatalkan",
  menunggu_pembayaran: "Menunggu Pembayaran",
};

/**
 * Menampilkan kembali dokumen check-in satu booking: foto KTP dan tanda
 * tangan tamu di atas tata tertib.
 *
 * Foto KTP diambil lewat URL bertanda tangan berumur pendek dari bucket
 * privat, jadi komponen ini memanggil ulang setiap kali dibuka dan tidak
 * menyimpan apa pun -- URL yang basi sengaja mati dengan sendirinya.
 */
export function DokumenCheckin({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  const [data, setData] = useState<DokumenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!bookingId) return;
    let cancelled = false;
    setLoading(true);
    localApi<DokumenResponse>(`/api/checkin/dokumen?booking_id=${encodeURIComponent(bookingId)}`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Gagal memuat dokumen check-in.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const b = data?.booking;
  const sudahCheckin = b?.status === "checkin" || b?.status === "checkout";

  return (
    <Modal
      open={!!bookingId}
      title="Detail Booking & Dokumen Check-In"
      onClose={onClose}
      footer={
        <Btn variant="primary" onClick={onClose}>
          Tutup
        </Btn>
      }
    >
      {loading && <div className="text-[11px] text-ink/30 text-center py-8">Memuat…</div>}
      {error && (
        <div className="text-[11px] text-ruby-400 border border-ruby-500/30 bg-ruby-500/5 rounded px-3 py-2.5 leading-relaxed">
          {error}
        </div>
      )}

      {b && (
        <>
          <div className="text-center mb-4">
            <div className="text-[13px] font-medium text-ink/80">{b.guest_nama}</div>
            <div className="text-[10.5px] text-ink/40 mt-0.5">
              Unit {b.unit_nomor ?? "—"} · {b.tipe ?? "—"} · {fmtDate(b.tgl_checkin)}
              {b.tgl_checkout ? ` – ${fmtDate(b.tgl_checkout)}` : ""}
            </div>
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <Badge tone={sudahCheckin ? "ok" : b.status === "batal" ? "danger" : "pending"}>
                {statusLabel[b.status] ?? b.status}
              </Badge>
              {b.sumber === "cloudbeds" && <Badge tone="pending">☁ Cloudbeds</Badge>}
            </div>
            {b.checkin_at && (
              <div className="text-[9.5px] text-ink/30 mt-2">
                Check-in {fmtDateTime(b.checkin_at)}
                {b.checkin_by ? ` · oleh ${b.checkin_by}` : ""}
              </div>
            )}
          </div>

          <div className="mb-5">
            <label className="block text-[9.5px] font-semibold text-ink/30 tracking-[0.12em] uppercase mb-1.5">
              Foto KTP / Paspor
            </label>
            {data?.ktpUrl ? (
              <>
                <a href={data.ktpUrl} target="_blank" rel="noopener noreferrer" title="Buka ukuran penuh di tab baru">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.ktpUrl}
                    alt={`KTP ${b.guest_nama}`}
                    className="w-full rounded-lg border border-ink/10 bg-white object-contain max-h-[260px]"
                  />
                </a>
                <div className="text-[9px] text-ink/30 mt-1.5 leading-relaxed">
                  Ketuk gambar untuk ukuran penuh. Tautannya berumur pendek dan mati sendiri — data pribadi tamu,
                  jangan disebar atau disimpan di luar sistem.
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-ink/15 px-3 py-5 text-[10.5px] text-ink/35 text-center leading-relaxed">
                {data?.ktpError
                  ? `Foto KTP tersimpan tapi gagal dibuka: ${data.ktpError}`
                  : sudahCheckin
                    ? "Tidak ada foto KTP pada booking ini — kemungkinan di-check-in sebelum kartu check-in digital dipakai."
                    : "Belum ada — foto KTP diambil saat proses check-in."}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[9.5px] font-semibold text-ink/30 tracking-[0.12em] uppercase mb-1.5">
              Tanda Tangan Tamu (persetujuan tata tertib)
            </label>
            {data?.signatureDataUrl ? (
              <>
                {/* Latar putih dipaksa di sini juga: tanda tangan yang dibuat
                    sebelum 2026-09-20 tersimpan dengan latar transparan, dan
                    tinta hitam di atas latar gelap tidak akan terbaca. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.signatureDataUrl}
                  alt={`Tanda tangan ${b.guest_nama}`}
                  className="w-full rounded-lg border border-ink/10 bg-white"
                />
                <div className="text-[9px] text-ink/30 mt-1.5 leading-relaxed">
                  Ditandatangani saat check-in sebagai persetujuan atas tata tertib — termasuk denda merokok di dalam
                  villa dan tanggung jawab atas kerusakan.
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-ink/15 px-3 py-5 text-[10.5px] text-ink/35 text-center leading-relaxed">
                {sudahCheckin
                  ? "Tidak ada tanda tangan pada booking ini — kemungkinan di-check-in sebelum kartu check-in digital dipakai."
                  : "Belum ada — tanda tangan diambil saat proses check-in."}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
