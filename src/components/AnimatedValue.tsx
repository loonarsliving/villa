"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Pecah teks menjadi awalan + SATU bilangan bulat + akhiran, atau null bila tidak cocok. */
export function pecahAngka(teks: string): { awal: string; angka: number; akhir: string; bertitik: boolean } | null {
  const cocok = teks.match(/\d+(?:\.\d{3})*/g);
  // Lebih dari satu kelompok angka ("12/15", "1,2 jt", "12,5%") tidak dianimasikan:
  // menebak bentuknya berisiko menampilkan angka yang menyesatkan.
  if (!cocok || cocok.length !== 1) return null;
  const mentah = cocok[0];
  const i = teks.indexOf(mentah);
  const angka = Number(mentah.replace(/\./g, ""));
  if (!Number.isSafeInteger(angka)) return null;
  return { awal: teks.slice(0, i), angka, akhir: teks.slice(i + mentah.length), bertitik: mentah.includes(".") || angka < 1000 };
}

/**
 * Menampilkan nilai kartu statistik dengan angka yang "berhitung" menuju
 * nilainya. Bingkai TERAKHIR selalu teks asli persis dari pemanggil -- animasi
 * hanya hiasan, tidak pernah mengubah angka akhirnya.
 */
export function AnimatedValue({ value, durasi = 700 }: { value: string; durasi?: number }) {
  const [tampil, setTampil] = useState(value);
  const sebelum = useRef(0);

  useIsoLayoutEffect(() => {
    const p = pecahAngka(value);
    const kurangiGerak = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!p || kurangiGerak || p.angka === sebelum.current) {
      setTampil(value);
      if (p) sebelum.current = p.angka;
      return;
    }
    const dari = sebelum.current;
    const ke = p.angka;
    sebelum.current = ke;
    const mulai = performance.now();
    let raf = 0;
    const langkah = (kini: number) => {
      const t = Math.min(1, (kini - mulai) / durasi);
      if (t >= 1) {
        setTampil(value);
        return;
      }
      const maju = 1 - Math.pow(1 - t, 3);
      const n = Math.round(dari + (ke - dari) * maju);
      setTampil(`${p.awal}${p.bertitik ? n.toLocaleString("id-ID") : String(n)}${p.akhir}`);
      raf = requestAnimationFrame(langkah);
    };
    langkah(mulai);
    return () => cancelAnimationFrame(raf);
  }, [value, durasi]);

  return <span className="tabular-nums">{tampil}</span>;
}
