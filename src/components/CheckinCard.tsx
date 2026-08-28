"use client";

import { useEffect, useRef, useState } from "react";
import { Modal, Btn } from "./Modal";
import { fmtDate } from "@/lib/format";
import { getToken } from "@/lib/api";
import { useToast } from "@/lib/toast";

export interface CheckinCardGuest {
  guestName: string;
  unitNomor: string;
  tipe: string;
  checkinDate: string;
  checkoutDate: string | null;
}

/**
 * Shared check-in card shown right before any booking actually flips to
 * "checkin" (walk-in after payment, OTA/existing booking on arrival, or a
 * manually-logged external-channel booking) -- captures a KTP photo and a
 * digital signature, both attached to the booking. Tahap 1 (2026-08-27):
 * just capture + store, no OCR/auto-read yet.
 */
export function CheckinCard({
  open,
  guest,
  onClose,
  onConfirm,
}: {
  open: boolean;
  guest: CheckinCardGuest | null;
  onClose: () => void;
  onConfirm: (data: { ktpPhotoPath: string; signatureDataUrl: string }) => Promise<void>;
}) {
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [ktpPreview, setKtpPreview] = useState<string | null>(null);
  const [ktpFile, setKtpFile] = useState<File | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKtpPreview(null);
    setKtpFile(null);
    setHasSignature(false);
    setSubmitting(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [open]);

  function onPickKtp(file: File | null) {
    if (!file) return;
    setKtpFile(file);
    const reader = new FileReader();
    reader.onload = () => setKtpPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function draw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  }
  function endDraw() {
    drawingRef.current = false;
  }
  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  function dataUrlFromFile(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!ktpFile) return reject(new Error("no file"));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(ktpFile);
    });
  }

  async function handleConfirm() {
    if (!ktpFile) {
      toast("⚠", "Foto KTP wajib", "Foto KTP/paspor tamu dulu sebelum check-in.", "ruby");
      return;
    }
    if (!hasSignature) {
      toast("⚠", "Tanda tangan wajib", "Minta tamu tanda tangan di layar dulu.", "ruby");
      return;
    }
    setSubmitting(true);
    try {
      const token = getToken();
      const dataUrl = await dataUrlFromFile();
      const res = await fetch("/api/checkin/upload-ktp", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "x-villa-token": token } : {}) },
        body: JSON.stringify({ dataUrl }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast("⚠", "Gagal unggah KTP", (body && body.error) || `HTTP ${res.status}`, "ruby");
        return;
      }
      const signatureDataUrl = canvasRef.current?.toDataURL("image/png") ?? "";
      await onConfirm({ ktpPhotoPath: body.path, signatureDataUrl });
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Form Check-In"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Batal</Btn>
          <Btn variant="primary" onClick={handleConfirm}>
            {submitting ? "Memproses…" : "Konfirmasi & Check-In"}
          </Btn>
        </>
      }
    >
      {guest && (
        <div className="text-center mb-4">
          <div className="text-[13px] font-medium text-ink/80">{guest.guestName}</div>
          <div className="text-[10.5px] text-ink/40 mt-0.5">
            Unit {guest.unitNomor} · {guest.tipe} · {fmtDate(guest.checkinDate)}
            {guest.checkoutDate ? ` – ${fmtDate(guest.checkoutDate)}` : ""}
          </div>
        </div>
      )}

      <div className="mb-5">
        <label className="block text-[9.5px] font-semibold text-ink/30 tracking-[0.12em] uppercase mb-1.5">Foto KTP / Paspor</label>
        {ktpPreview ? (
          <div className="flex items-center gap-3">
            <img src={ktpPreview} alt="KTP" className="w-24 h-16 object-cover rounded border border-ink/10" />
            <label className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 cursor-pointer">
              Ganti Foto
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPickKtp(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-1 w-full py-6 rounded-lg border border-dashed border-ink/15 text-ink/40 cursor-pointer">
            <span className="text-lg">📷</span>
            <span className="text-[10.5px]">Ambil / Unggah Foto KTP</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPickKtp(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>

      <div className="mb-1">
        <label className="block text-[9.5px] font-semibold text-ink/30 tracking-[0.12em] uppercase mb-1.5">Tanda Tangan Tamu</label>
        <canvas
          ref={canvasRef}
          width={360}
          height={140}
          className="w-full rounded-lg border border-ink/15 bg-white touch-none"
          style={{ touchAction: "none" }}
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
        />
        <button type="button" onClick={clearSignature} className="text-[10px] text-ink/40 mt-1.5">
          Hapus tanda tangan
        </button>
      </div>
    </Modal>
  );
}
