"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtDate, todayISO } from "@/lib/format";
import { buildHandover, handoverText, rentangTanggal, type Handover, type HandoverBooking, type HandoverItem } from "@/lib/handover";

/**
 * Daftar tamu hari ini di bawah Peta Unit Front Desk: In House, Check-out,
 * Check-in -- supaya serah terima shift tidak perlu laporan manual di grup WA
 * (owner 2026-10-13). Tombol "Salin untuk WA" menghasilkan teks dengan
 * format laporan lama kalau tetap ingin dikirim ke grup.
 */
export function HandoverHarian({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<Handover | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disalin, setDisalin] = useState(false);
  const hariIni = todayISO();

  const load = useCallback(async () => {
    const kemarin = todayISO(new Date(Date.now() - 86400000));
    const besok = todayISO(new Date(Date.now() + 86400000));
    try {
      // Rentang kemarin..besok = semua booking yang masuk <= hari ini dan
      // keluar >= hari ini (lihat datesOverlap di villa-api).
      const rows = await api.get<HandoverBooking[]>(`/bookings?date_from=${kemarin}&date_to=${besok}`);
      setData(buildHandover(rows || [], todayISO()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat jadwal tamu");
    }
  }, []);

  useEffect(() => {
    let aktif = true;
    const jalan = () => { if (aktif) load(); };
    jalan();
    const t = setInterval(jalan, 60000);
    return () => { aktif = false; clearInterval(t); };
  }, [load, refreshKey]);

  const judulTanggal = fmtDate(hariIni, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

  async function salin() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(handoverText(data, judulTanggal));
      setDisalin(true);
      setTimeout(() => setDisalin(false), 2500);
    } catch {
      setError("Browser tidak mengizinkan menyalin otomatis.");
    }
  }

  return (
    <div className="border-t border-ink/[0.06] mt-4 pt-4">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div>
          <div className="text-[11.5px] font-semibold text-ink/80">Jadwal Tamu Hari Ini</div>
          <div className="text-[9.5px] text-ink/40">{judulTanggal} · untuk serah terima shift</div>
        </div>
        <button
          onClick={salin}
          disabled={!data}
          className="text-[10.5px] text-ink/70 bg-base-800 border border-ink/10 rounded px-2.5 py-1.5 whitespace-nowrap disabled:opacity-40"
        >
          {disalin ? "✓ Tersalin" : "📋 Salin untuk WA"}
        </button>
      </div>
      {error && <div className="text-[11px] text-ruby-500 mb-2">{error}</div>}
      {!data ? (
        <div className="text-[11px] text-ink/30 py-3">Memuat jadwal tamu…</div>
      ) : (
        <div className="grid sm:grid-cols-3 gap-3">
          <Kolom judul="In House" warna="bg-gold-500" items={data.inHouse} kosong="Tidak ada tamu menginap" />
          <Kolom judul="Check-out" warna="bg-ruby-500" items={data.checkout} kosong="Tidak ada check-out" />
          <Kolom judul="Check-in" warna="bg-azure-500" items={data.checkin} kosong="Tidak ada check-in" />
        </div>
      )}
    </div>
  );
}

function Kolom({ judul, warna, items, kosong }: { judul: string; warna: string; items: HandoverItem[]; kosong: string }) {
  return (
    <div className="rounded-lg border border-ink/[0.08] bg-base-800/40">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ink/[0.06]">
        <span className={`w-1.5 h-1.5 rounded-full ${warna}`} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink/60">{judul}</span>
        <span className="text-[10px] text-ink/35 ml-auto">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-[10.5px] text-ink/30 px-3 py-3">{kosong}</div>
      ) : (
        items.map((b) => {
          const selesai = b.keadaan === "Sudah check-out" || b.keadaan === "Sudah check-in" || b.keadaan === "Menginap";
          return (
            <div key={b.id} className="px-3 py-2 border-b border-ink/[0.05] last:border-0">
              <div className="flex items-center gap-2">
                <span className="font-serif text-[13px] text-ink w-8 shrink-0">{b.unit_nomor ?? "-"}</span>
                <span className="text-[11.5px] text-ink/80 font-medium truncate">{b.guest_nama}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5 pl-10">
                <span className="text-[10px] text-ink/45">{rentangTanggal(b.tgl_checkin, b.tgl_checkout)}</span>
                {b.keadaan !== "Menginap" && (
                  <span className={`text-[8.5px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 border ${
                    selesai ? "text-sage-700 bg-sage-500/15 border-sage-500/30" : "text-gold-700 bg-gold-500/15 border-gold-500/30"
                  }`}>{b.keadaan}</span>
                )}
                {b.paket_dekorasi && <span className="text-[9.5px] text-gold-700">🎉 {b.paket_dekorasi}</span>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
