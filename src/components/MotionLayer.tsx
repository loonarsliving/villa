"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Lapisan gerak interaktif untuk SELURUH dashboard (owner 2026-11-14: "kurang
 * banyak animasi yang interaktif, kurang menakjubkan"). Satu komponen, dipasang
 * sekali di root layout, memberi efek ke semua halaman lewat kelas CSS:
 *
 *  - `.spot`   : sorotan cahaya yang mengikuti kursor (variabel --mx/--my).
 *  - `.tilt`   : kartu miring 3D mengikuti kursor (hanya mouse/trackpad).
 *  - tombol    : riak (ripple) saat diketuk -- semua <button> & [data-ripple].
 *  - `.anim-fade-up` di luar layar: ditahan sampai terlihat saat digulir.
 *  - garis progres terakota di atas layar setiap pindah halaman.
 *  - konfeti: `window.dispatchEvent(new CustomEvent("villa:rayakan", {detail:{x,y}}))`.
 *
 * ATURAN PROYEK: tidak ada transform permanen pada kartu/pembungkus halaman
 * (elemen position:fixed di dalamnya akan salah posisi). Riak & konfeti memakai
 * elemen sendiri; tilt hanya pada `.tilt` (kartu statistik, tanpa anak fixed)
 * dan dilepas begitu kursor pergi. Semua dimatikan untuk "kurangi gerakan".
 */
export function MotionLayer() {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);
  const pertama = useRef(true);

  // Garis progres setiap pindah halaman (bukan saat halaman pertama dibuka).
  useEffect(() => {
    if (pertama.current) {
      pertama.current = false;
      return;
    }
    const bar = barRef.current;
    if (!bar) return;
    bar.classList.remove("route-bar-go");
    void bar.offsetWidth; // mulai ulang animasi
    bar.classList.add("route-bar-go");
  }, [pathname]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const finePointer = window.matchMedia("(pointer: fine)").matches;

    // ── Sorotan & tilt mengikuti kursor (satu listener, di-throttle per frame) ──
    let raf = 0;
    let lastEvent: PointerEvent | null = null;
    let tiltAktif: HTMLElement | null = null;
    const lepasTilt = () => {
      if (tiltAktif) {
        tiltAktif.style.transform = "";
        tiltAktif = null;
      }
    };
    const frame = () => {
      raf = 0;
      const e = lastEvent;
      if (!e) return;
      const target = e.target as Element | null;
      const spot = target?.closest?.(".spot") as HTMLElement | null;
      if (spot) {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty("--mx", `${e.clientX - r.left}px`);
        spot.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
      if (!finePointer) return;
      const tilt = target?.closest?.(".tilt") as HTMLElement | null;
      if (tilt !== tiltAktif) lepasTilt();
      if (tilt) {
        const r = tilt.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.transform = `perspective(700px) rotateX(${(-py * 9).toFixed(2)}deg) rotateY(${(px * 11).toFixed(2)}deg) translateY(-3px)`;
        tiltAktif = tilt;
      }
    };
    const onMove = (e: PointerEvent) => {
      lastEvent = e;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onLeaveDoc = () => lepasTilt();

    // ── Riak saat tombol diketuk ──
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('button, [data-ripple], a[role="button"]') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 18) return;
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      const wrap = document.createElement("span");
      wrap.className = "ripple-wrap";
      const dot = document.createElement("span");
      dot.className = "ripple";
      const size = Math.max(r.width, r.height) * 2.2;
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - r.left - size / 2}px`;
      dot.style.top = `${e.clientY - r.top - size / 2}px`;
      wrap.appendChild(dot);
      el.appendChild(wrap);
      window.setTimeout(() => wrap.remove(), 650);
    };

    // ── Kartu di luar layar baru beranimasi saat digulir ke dalam layar ──
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.remove("io-wait");
            io.unobserve(en.target);
          }
        }
      },
      { rootMargin: "0px 0px -40px 0px", threshold: 0.05 },
    );
    const tahanBilaDiLuarLayar = (el: Element) => {
      if (!(el instanceof HTMLElement) || el.dataset.ioSeen) return;
      el.dataset.ioSeen = "1";
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight + 10) {
        el.classList.add("io-wait");
        io.observe(el);
      }
    };
    document.querySelectorAll(".anim-fade-up").forEach(tahanBilaDiLuarLayar);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.classList.contains("anim-fade-up")) tahanBilaDiLuarLayar(n);
          n.querySelectorAll?.(".anim-fade-up").forEach(tahanBilaDiLuarLayar);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // ── Konfeti ──
    const WARNA = ["#b4693f", "#d6b98f", "#4f6e55", "#e7c9a5", "#c5614f", "#6f8b6a"];
    const onRayakan = (ev: Event) => {
      const d = (ev as CustomEvent<{ x?: number; y?: number }>).detail ?? {};
      const x = d.x ?? window.innerWidth / 2;
      const y = d.y ?? window.innerHeight / 3;
      const box = document.createElement("div");
      box.className = "confetti-box";
      for (let i = 0; i < 34; i++) {
        const p = document.createElement("i");
        const sudut = Math.random() * Math.PI * 2;
        const jarak = 70 + Math.random() * 150;
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.background = WARNA[i % WARNA.length];
        p.style.setProperty("--dx", `${Math.cos(sudut) * jarak}px`);
        p.style.setProperty("--dy", `${Math.sin(sudut) * jarak - 60}px`);
        p.style.setProperty("--rot", `${Math.round(Math.random() * 720 - 360)}deg`);
        p.style.animationDelay = `${Math.random() * 0.08}s`;
        if (i % 3 === 0) p.style.borderRadius = "50%";
        box.appendChild(p);
      }
      document.body.appendChild(box);
      window.setTimeout(() => box.remove(), 1600);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeaveDoc);
    document.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("villa:rayakan", onRayakan);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeaveDoc);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("villa:rayakan", onRayakan);
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return <div ref={barRef} className="route-bar" aria-hidden />;
}
