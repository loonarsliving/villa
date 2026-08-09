"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export function DashboardShell({
  brandTitle,
  brandSub,
  roleLabel,
  sections,
  pageTitle,
  pageSub,
  topBarExtra,
  children,
}: {
  brandTitle: string;
  brandSub: ReactNode;
  roleLabel: string;
  sections: NavSection[];
  pageTitle: string;
  pageSub?: string;
  topBarExtra?: ReactNode;
  children: ReactNode;
}) {
  const { user, logout, ready } = useAuth();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white/30 text-xs tracking-wide">
        Memuat sesi...
      </div>
    );
  }

  const navContent = (
    <>
      <div className="px-5 py-5 border-b border-white/[0.08]">
        <div className="text-[10px] font-medium text-gold-500 tracking-[0.25em] uppercase">Loonars Private Living</div>
        <div className="font-serif text-lg font-light text-white leading-tight mt-1">
          {brandTitle}
          <br />
          <em className="italic text-gold-500">{brandSub}</em>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-4">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className="text-[8.5px] font-semibold text-white/30 tracking-[0.18em] uppercase px-2 my-3.5">{sec.title}</div>
            {sec.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded text-[13px] mb-0.5 transition-colors ${
                    active
                      ? "bg-gold-500/10 text-gold-500 border-l-2 border-gold-500 pl-2"
                      : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                  }`}
                >
                  <span className="w-4 text-center text-sm shrink-0">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                  {!!item.badge && (
                    <span className="ml-auto bg-ruby-500 text-white text-[8.5px] font-bold px-1.5 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="p-3.5 border-t border-white/[0.08] flex items-center gap-2.5">
        <div className="w-7 h-7 bg-gold-500/10 border border-gold-500/25 rounded-full flex items-center justify-center text-[10px] font-semibold text-gold-500 shrink-0">
          {initials(user?.nama)}
        </div>
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium text-white truncate">{user?.nama || "—"}</div>
          <div className="text-[9.5px] text-white/30">{roleLabel}</div>
        </div>
        <button
          onClick={logout}
          className="ml-auto text-[10px] text-white/30 hover:text-white/60 px-2 py-1 border border-white/10 rounded shrink-0"
        >
          Keluar
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop / tablet sidebar */}
      <aside className="hidden md:flex md:w-[220px] md:min-w-[220px] h-screen bg-base-900 border-r border-white/[0.08] fixed top-0 left-0 flex-col z-40">
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} />
          <aside className="relative w-[260px] max-w-[80vw] h-full bg-base-900 border-r border-white/[0.08] flex flex-col">
            {navContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col md:ml-[220px]">
        <header className="h-14 bg-base-900 border-b border-white/[0.08] flex items-center justify-between px-4 sm:px-7 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setDrawerOpen(true)}
              className="md:hidden w-8 h-8 flex items-center justify-center text-white/60 shrink-0"
              aria-label="Buka menu"
            >
              ☰
            </button>
            <div className="min-w-0">
              <div className="font-serif text-lg sm:text-xl font-light text-white truncate">{pageTitle}</div>
              {pageSub && <div className="text-[10px] text-white/30 truncate hidden sm:block">{pageSub}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">{topBarExtra}</div>
        </header>
        <main className="p-4 sm:p-6 lg:p-7 flex-1">{children}</main>
      </div>
    </div>
  );
}
