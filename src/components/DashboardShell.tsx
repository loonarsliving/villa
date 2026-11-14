"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
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

// Posisi penanda menu aktif & gulir sidebar dari halaman sebelumnya. Shell
// dipasang ulang tiap pindah halaman, jadi nilainya disimpan di luar komponen
// supaya penanda bisa "meluncur" dari menu lama ke menu baru dan sidebar tidak
// melompat kembali ke atas.
let penandaSebelumnya: number | null = null;
let gulirSidebar = 0;
// Menu bermunculan berurutan hanya sekali per sesi tab (bukan tiap pindah halaman).
let menuSudahMasuk = false;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function NavList({ sections, pathname, onNavigate }: { sections: NavSection[]; pathname: string; onNavigate: () => void }) {
  const navRef = useRef<HTMLElement | null>(null);
  const penandaRef = useRef<HTMLSpanElement | null>(null);
  const kunci = sections.map((s) => s.items.map((i) => i.href).join(",")).join("|");

  useEffect(() => {
    menuSudahMasuk = true;
  }, []);

  useIsoLayoutEffect(() => {
    const nav = navRef.current;
    const penanda = penandaRef.current;
    if (!nav || !penanda) return;
    nav.scrollTop = gulirSidebar;
    const aktif = nav.querySelector<HTMLElement>('[data-aktif="true"]');
    if (!aktif) {
      penanda.style.opacity = "0";
      return;
    }
    const top = aktif.offsetTop;
    penanda.style.opacity = "1";
    penanda.style.top = `${top}px`;
    penanda.style.height = `${aktif.offsetHeight}px`;
    const kurangiGerak = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (penandaSebelumnya !== null && penandaSebelumnya !== top && !kurangiGerak && penanda.animate) {
      penanda.animate([{ transform: `translateY(${penandaSebelumnya - top}px)` }, { transform: "translateY(0)" }], {
        duration: 380,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
    }
    penandaSebelumnya = top;
  }, [pathname, kunci]);

  let nomorMenu = 0;
  const animasiMasuk = !menuSudahMasuk;
  return (
    <nav
      ref={navRef}
      onScroll={(e) => {
        gulirSidebar = e.currentTarget.scrollTop;
      }}
      className="relative flex-1 overflow-y-auto px-2.5 py-4"
    >
      <div className="relative">
        <span
          ref={penandaRef}
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 rounded-xl bg-cream/[0.1] border-l-2 border-gold-400 shadow-[inset_0_0_0_1px_rgba(246,241,232,0.06)] opacity-0"
        />
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className="text-[8.5px] font-semibold text-[#d6b98f]/70 tracking-[0.22em] uppercase px-2 py-3.5">{sec.title}</div>
            {sec.items.map((item) => {
              const urutan = nomorMenu++;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-aktif={active}
                  onClick={onNavigate}
                  style={animasiMasuk ? { animationDelay: `${0.1 + urutan * 0.035}s` } : undefined}
                  className={`group relative flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-[13px] mb-0.5 ${animasiMasuk ? "nav-in " : ""}${
                    active ? "text-white font-medium" : "text-cream/65 hover:bg-cream/[0.06] hover:text-cream"
                  }`}
                >
                  <span className="w-4 text-center text-sm shrink-0 transition-transform duration-300 group-hover:scale-125">{item.icon}</span>
                  <span className="truncate transition-transform duration-300 group-hover:translate-x-0.5">{item.label}</span>
                  {!!item.badge && (
                    <span className="anim-pop anim-ping ml-auto bg-ruby-500 text-white text-[8.5px] font-bold px-1.5 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function DashboardShell({
  brandTitle,
  brandSub,
  roleLabel,
  sections,
  pageTitle,
  pageSub,
  topBarExtra,
  property = "Loonars Private Living",
  children,
}: {
  brandTitle: string;
  brandSub: ReactNode;
  roleLabel: string;
  sections: NavSection[];
  pageTitle: string;
  pageSub?: string;
  topBarExtra?: ReactNode;
  /** Nama properti di atas sidebar -- Excellent Living memakai shell yang sama. */
  property?: string;
  children: ReactNode;
}) {
  const { user, logout, ready } = useAuth();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!ready) {
    return (
      <div className="anim-fade min-h-screen flex flex-col items-center justify-center gap-4 text-ink/50 text-xs tracking-wide">
        <div className="font-serif text-2xl font-light text-ink/70">
          Loonars <em className="italic text-gold-500">Living</em>
        </div>
        <div className="skeleton h-1 w-40" />
        Memuat sesi...
      </div>
    );
  }

  const flatItems = sections.flatMap((s) => s.items);
  const bottomItems = flatItems.slice(0, 4);

  const navContent = (
    <>
      <div className="relative px-5 py-5 border-b border-cream/[0.08]">
        <div className="text-[9px] font-medium text-[#d6b98f] tracking-[0.18em] uppercase whitespace-nowrap truncate">{property}</div>
        <div className="font-serif text-lg font-light text-cream leading-tight mt-1">
          {brandTitle}
          <br />
          <em className="italic text-[#e7c9a5]">{brandSub}</em>
        </div>
      </div>
      <NavList sections={sections} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
      <div className="relative p-3.5 border-t border-cream/[0.08] flex items-center gap-2.5">
        <div className="w-7 h-7 bg-cream/10 border border-cream/25 rounded-full flex items-center justify-center text-[10px] font-semibold text-[#e7c9a5] shrink-0">
          {initials(user?.nama)}
        </div>
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium text-cream truncate">{user?.nama || "—"}</div>
          <div className="text-[9.5px] text-cream/45">{roleLabel}</div>
        </div>
        <button
          onClick={logout}
          className="ml-auto text-[10px] text-cream/55 hover:text-white hover:border-ruby-400/60 hover:bg-ruby-500/20 px-2 py-1 border border-cream/15 rounded-md shrink-0"
        >
          Keluar
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop / tablet sidebar */}
      <aside className="hidden md:flex md:w-[220px] md:min-w-[220px] h-screen bg-forest text-cream fixed top-0 left-0 flex-col z-40 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-70" style={{ background: "radial-gradient(20rem 11rem at 15% 0%, rgba(180,105,63,0.25), transparent 70%)" }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full border border-cream/5 shadow-[0_0_0_36px_rgba(246,241,232,0.02),0_0_0_72px_rgba(246,241,232,0.015)]" />
        {navContent}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <div key="drawer" className="md:hidden fixed inset-0 z-50 flex">
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-forest/50 backdrop-blur-[3px]"
              onClick={() => setDrawerOpen(false)}
            />
            <m.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              className="relative w-[260px] max-w-[80vw] h-full bg-forest text-cream flex flex-col shadow-2xl shadow-ink/30"
            >
              {navContent}
            </m.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-w-0 flex flex-col md:ml-[220px]">
        <header className="h-14 bg-canvas/85 backdrop-blur-xl border-b border-ink/[0.07] shadow-[0_10px_30px_-24px_rgba(43,38,32,0.4)] flex items-center justify-between px-4 sm:px-7 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setDrawerOpen(true)}
              className="md:hidden w-8 h-8 flex items-center justify-center text-ink/60 shrink-0"
              aria-label="Buka menu"
            >
              ☰
            </button>
            <div key={pathname} className="anim-fade-up min-w-0">
              <div className="font-serif text-xl sm:text-2xl font-normal text-ink truncate" aria-label={pageTitle}>
                {pageTitle.split(" ").map((w, i) => (
                  <span key={i} className="kata" aria-hidden>
                    <span style={{ animationDelay: `${0.05 + i * 0.07}s` }}>{w}</span>
                    {"\u00a0"}
                  </span>
                ))}
              </div>
              {pageSub && <div className="text-[10px] text-ink/50 truncate hidden sm:block">{pageSub}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">{topBarExtra}</div>
        </header>
        {/* Hanya opacity: transform di sini akan merusak posisi elemen `fixed` di dalam halaman. */}
        <main className="anim-fade p-4 sm:p-6 lg:p-7 flex-1 pb-24 md:pb-7">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-base-900/90 backdrop-blur-md border-t border-ink/[0.08] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 flex items-stretch justify-between shadow-[0_-4px_20px_rgba(20,22,27,0.06)]">
        {bottomItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl text-[9.5px] font-medium ${
                active ? "text-gold-600" : "text-ink/40"
              }`}
            >
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${active ? "anim-pop bg-gold-500/15 shadow-sm shadow-gold-500/20" : ""}`}>
                {item.icon}
              </span>
              <span className="block w-full truncate text-center px-0.5">{item.label}</span>
              {!!item.badge && <span className="anim-ping absolute top-0.5 right-3 w-1.5 h-1.5 rounded-full bg-ruby-500" />}
            </Link>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          className="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl text-[9.5px] font-medium text-ink/40"
        >
          <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm">☰</span>
          <span>Lainnya</span>
        </button>
      </nav>
    </div>
  );
}
