"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m } from "motion/react";

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  // Dirender ke <body> (portal) supaya posisinya tidak terpengaruh animasi
  // atau `overflow-hidden` kartu/halaman yang memanggilnya.
  const [siap, setSiap] = useState(false);
  useEffect(() => setSiap(true), []);

  // Tombol Esc menutup modal -- sama dengan klik di luar kotak.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!siap) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <m.div
          key="modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 bg-ink/50 backdrop-blur-[3px] z-[200] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <m.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.8 }}
            className={`bg-base-900 border border-ink/10 rounded-2xl w-full ${wide ? "max-w-[860px]" : "max-w-[440px]"} max-h-[90vh] overflow-y-auto shadow-2xl shadow-ink/25`}
          >
            <div className="px-5 py-4 border-b border-ink/10 flex items-center justify-between">
              <div className="font-serif text-lg font-light text-ink">{title}</div>
              <button
                onClick={onClose}
                aria-label="Tutup"
                className="w-7 h-7 rounded-full border border-ink/10 bg-base-800 flex items-center justify-center text-xs text-ink/50 hover:bg-base-700 hover:text-ink/80 hover:rotate-90 transition-transform duration-300"
              >
                ✕
              </button>
            </div>
            <div className="p-5">{children}</div>
            <div className="px-5 py-3.5 border-t border-ink/10 flex gap-2.5 justify-end">{footer}</div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <label className="block text-[9.5px] font-semibold text-ink/30 tracking-[0.12em] uppercase mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export const inputCls =
  "w-full py-2.5 border-0 border-b border-ink/10 bg-transparent text-[12.5px] text-ink outline-none focus:border-gold-500 transition-colors placeholder:text-ink/20";

export function Btn({
  children,
  onClick,
  variant = "ghost",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "primary";
  type?: "button" | "submit";
  /**
   * Dipakai untuk mengunci tombol selama satu aksi sedang berjalan. Tanpa
   * ini, dobel-klik pada tombol seperti "Konfirmasi & Check-In" atau
   * "Tandai Lunas" mengirim aksi yang sama dua kali.
   */
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={`px-4 py-2 rounded-lg text-[11.5px] font-semibold tracking-wide ${
        variant === "primary"
          ? "sheen bg-gold-500 text-base-950 shadow-sm shadow-gold-500/30 hover:bg-gold-400 hover:shadow-md hover:shadow-gold-500/40"
          : "bg-base-800 text-ink/50 border border-ink/10 hover:bg-base-700 hover:text-ink/70"
      } ${disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
    >
      {children}
    </button>
  );
}
