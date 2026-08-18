"use client";

import type { ReactNode } from "react";

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-base-900 border border-ink/10 rounded-md w-full max-w-[440px] max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-4 border-b border-ink/10 flex items-center justify-between">
          <div className="font-serif text-lg font-light text-ink">{title}</div>
          <button
            onClick={onClose}
            className="w-6.5 h-6.5 rounded border border-ink/10 bg-base-800 flex items-center justify-center text-xs text-ink/50"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
        <div className="px-5 py-3.5 border-t border-ink/10 flex gap-2.5 justify-end">{footer}</div>
      </div>
    </div>
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
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "primary";
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`px-4 py-2 rounded text-[11.5px] font-semibold tracking-wide transition-opacity ${
        variant === "primary" ? "bg-gold-500 text-base-950 hover:opacity-90" : "bg-base-800 text-ink/50 border border-ink/10"
      }`}
    >
      {children}
    </button>
  );
}
