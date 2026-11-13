"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";

type ToastKind = "gold" | "sage" | "azure" | "ruby";

interface ToastItem {
  id: number;
  icon: string;
  title: string;
  msg: string;
  kind: ToastKind;
}

const kindBorder: Record<ToastKind, string> = {
  gold: "border-l-gold-500",
  sage: "border-l-sage-500",
  azure: "border-l-azure-500",
  ruby: "border-l-ruby-500",
};

const ToastContext = createContext<(icon: string, title: string, msg: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((icon: string, title: string, msg: string, kind: ToastKind = "gold") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, icon, title, msg, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed top-4 right-4 z-[300] flex flex-col gap-2 w-[min(90vw,320px)]">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <m.div
              key={t.id}
              role="status"
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className={`relative overflow-hidden bg-base-900 border border-ink/10 border-l-[3px] ${kindBorder[t.kind]} rounded-xl p-3.5 shadow-xl shadow-ink/10 flex gap-3`}
            >
              <div className="anim-pop text-base shrink-0 mt-0.5">{t.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink">{t.title}</div>
                <div className="text-xs text-ink/50 mt-0.5 leading-relaxed">{t.msg}</div>
              </div>
              <button
                onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
                aria-label="Tutup pemberitahuan"
                className="text-ink/50 hover:text-ink/60 text-xs shrink-0"
              >
                ✕
              </button>
              {/* Garis waktu: habis tepat saat toast hilang (5 detik). */}
              <span
                aria-hidden
                className="absolute left-0 bottom-0 h-[2px] w-full origin-left bg-ink/15"
                style={{ animation: "bar-grow 5s linear reverse forwards" }}
              />
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
