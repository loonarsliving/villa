"use client";

import { useEffect, useRef, useState } from "react";
import { ManagerShell } from "../_shell";
import { api, localApi } from "@/lib/api";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { Modal, Btn } from "@/components/Modal";
import type { CctvCamera } from "@/lib/types";

type KameraManager = Pick<
  CctvCamera,
  "id" | "nama" | "zona" | "deskripsi" | "ezviz_serial" | "ezviz_channel_no" | "ezviz_verification_code" | "is_active"
>;

/**
 * CCTV untuk manager -- hanya menonton live (owner 9 Okt 2026). Mendaftarkan
 * atau mengubah kamera dan laporan checkpoint AI tetap di /admin/cctv.
 * Pemutarnya sama dengan halaman admin (EZUIKit), ukurannya mengikuti lebar
 * layar karena manager memakai HP.
 */
export default function ManagerCctvPage() {
  const [kamera, setKamera] = useState<KameraManager[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [nonton, setNonton] = useState<KameraManager | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [galatNonton, setGalatNonton] = useState<string | null>(null);
  const playerRef = useRef<{ stop: () => void } | null>(null);
  const wadahRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .get<KameraManager[]>("/manager/cctv/cameras")
      .then((k) => setKamera(k || []))
      .catch((e) => setGalat(e instanceof Error ? e.message : "Gagal memuat kamera"));
  }, []);

  function tutup() {
    playerRef.current?.stop();
    playerRef.current = null;
    setNonton(null);
    setGalatNonton(null);
  }

  useEffect(() => {
    if (!nonton) return;
    let batal = false;
    setMemuat(true);
    setGalatNonton(null);

    (async () => {
      try {
        const body = await localApi<{ accessToken: string; domain: string }>("/api/cctv/token");
        if (batal) return;
        const { EZUIKitPlayer } = await import("ezuikit-js");
        if (batal) return;

        // Sama dengan /admin/cctv: open.ezviz.com, bukan open.ys7.com.
        const url = nonton.ezviz_verification_code
          ? `ezopen://${nonton.ezviz_verification_code}@open.ezviz.com/${nonton.ezviz_serial}/${nonton.ezviz_channel_no}.live`
          : `ezopen://open.ezviz.com/${nonton.ezviz_serial}/${nonton.ezviz_channel_no}.live`;
        const lebar = Math.min(800, Math.max(280, wadahRef.current?.clientWidth ?? 360));

        const player = new EZUIKitPlayer({
          id: "manager-cctv-player",
          accessToken: body.accessToken,
          url,
          template: "security",
          width: lebar,
          height: Math.round(lebar * 0.6),
          env: { domain: body.domain },
        });
        playerRef.current = player as unknown as { stop: () => void };
      } catch (e) {
        if (!batal) setGalatNonton(e instanceof Error ? e.message : "Gagal memulai live-view");
      } finally {
        if (!batal) setMemuat(false);
      }
    })();

    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonton?.id]);

  return (
    <ManagerShell pageTitle="CCTV" pageSub="Live-view kamera villa">
      <Card>
        <CardHeader title="Kamera" subtitle="Ketuk kamera untuk menonton live" />
        {galat ? (
          <Empty label={galat} />
        ) : !kamera ? (
          <Loading />
        ) : kamera.length === 0 ? (
          <Empty label="Belum ada kamera aktif" />
        ) : (
          kamera.map((k) => (
            <button
              key={k.id}
              onClick={() => setNonton(k)}
              className="w-full text-left flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 hover:bg-base-800"
            >
              <div className="w-10 h-10 shrink-0 rounded-lg bg-base-800 border border-ink/10 flex items-center justify-center text-[15px]">◍</div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink truncate">{k.nama}</div>
                <div className="text-[11px] text-ink/40 truncate">{k.deskripsi || (k.zona ? `Zona ${k.zona}` : "—")}</div>
              </div>
              <span className="text-[11px] font-semibold text-gold-500 shrink-0">Tonton ›</span>
            </button>
          ))
        )}
      </Card>

      <Modal
        open={nonton !== null}
        title={`Live — ${nonton?.nama ?? ""}`}
        onClose={tutup}
        wide
        footer={
          <Btn variant="primary" onClick={tutup}>
            Tutup
          </Btn>
        }
      >
        <div ref={wadahRef} className="w-full">
          {memuat && <div className="text-center py-10 text-[11px] text-ink/30">Menghubungkan ke kamera…</div>}
          {galatNonton && (
            <div className="text-center py-10 text-[11px] text-ruby-400 leading-relaxed px-4">
              Gagal live-view: {galatNonton}
              <br />
              <span className="text-ink/30">Coba lagi sebentar. Kalau tetap gagal, hubungi admin.</span>
            </div>
          )}
          <div id="manager-cctv-player" className={memuat || galatNonton ? "hidden" : ""} />
        </div>
      </Modal>
    </ManagerShell>
  );
}
