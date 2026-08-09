"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

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
        {items.map((t) => (
          <div
            key={t.id}
            className={`bg-base-800 border border-base-700 border-l-2 ${kindBorder[t.kind]} rounded-md p-3.5 shadow-2xl flex gap-3 animate-in slide-in-from-right`}
          >
            <div className="text-base shrink-0 mt-0.5">{t.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">{t.title}</div>
              <div className="text-xs text-white/50 mt-0.5 leading-relaxed">{t.msg}</div>
            </div>
            <button
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-white/30 hover:text-white/60 text-xs shrink-0"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
