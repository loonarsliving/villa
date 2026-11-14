"use client";

import { useEffect } from "react";

/**
 * Semua tabel di dashboard menjadi KARTU di layar HP (owner 2026-11-14:
 * "rombak semua halaman pakai gaya yang sama" dengan halaman Pendapatan &
 * Channel -- tidak ada lagi tabel yang melebar & terpotong di HP).
 *
 * Cara kerja: komponen ini dipasang sekali di root layout. Untuk setiap
 * <table> yang punya <thead>, setiap sel diberi `data-label` = judul kolomnya,
 * dan tabel diberi `data-tk`. CSS di globals.css (max-width 639px) lalu
 * menampilkan tiap baris sebagai kartu: sel pertama jadi judul kartu, sel lain
 * jadi pasangan "label ... nilai". Di layar lebar tabel tampil seperti biasa.
 *
 * Hanya atribut data-* yang ditambahkan (React tidak pernah menyentuh atribut
 * yang tidak ia kelola), jadi isi, tombol, input, dan perilaku tabel tidak
 * berubah sama sekali. Tabel yang memang harus tetap berbentuk tabel (kalender
 * harga, tampilan "Tabel" di halaman Pendapatan) memakai `data-tabel="asli"`.
 */

export function labelKolom(table: HTMLTableElement): string[] {
  const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!headRow) return [];
  const out: string[] = [];
  for (const th of Array.from(headRow.cells)) {
    const teks = (th.textContent ?? "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < Math.max(1, th.colSpan); i++) out.push(teks);
  }
  return out;
}

export function tandaiTabel(table: HTMLTableElement): void {
  if (table.closest('[data-tabel="asli"]')) return;
  const label = labelKolom(table);
  if (label.length < 3) return; // tabel 1-2 kolom sudah muat di HP
  if (table.dataset.tk !== "1") table.dataset.tk = "1";
  const bagian = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const sec of bagian) {
    for (const tr of Array.from(sec.rows)) {
      let kol = 0;
      let isi = 0;
      for (const td of Array.from(tr.cells)) {
        const span = Math.max(1, td.colSpan);
        const l = label[kol] ?? "";
        const penuh = span >= 2 || !l;
        if (penuh) {
          if (td.dataset.penuh !== "1") td.dataset.penuh = "1";
        } else {
          if (td.dataset.label !== l) td.dataset.label = l;
          if (td.dataset.penuh) delete td.dataset.penuh;
        }
        const kosong = !(td.textContent ?? "").trim() && !td.querySelector("input,select,button,img,svg,a");
        if (kosong) td.dataset.kosong = "1";
        else if (td.dataset.kosong) delete td.dataset.kosong;
        if (!kosong) isi++;
        kol += span;
      }
      const sel = Array.from(tr.cells);
      // Baris catatan/kosong ("Tidak ada data", rincian colSpan) tampil sebagai satu blok.
      const satu = sel.length > 0 && (isi <= 1 && sel.some((c) => c.colSpan >= 2)) && sel.every((c) => c.colSpan >= 2 || c.dataset.kosong === "1");
      if (satu) tr.dataset.tkSatu = "1";
      else if (tr.dataset.tkSatu) delete tr.dataset.tkSatu;
    }
  }
}

export function TabelKartu() {
  useEffect(() => {
    let raf = 0;
    const jalan = () => {
      raf = 0;
      document.querySelectorAll("table").forEach((t) => tandaiTabel(t as HTMLTableElement));
    };
    const jadwal = () => {
      if (!raf) raf = requestAnimationFrame(jalan);
    };
    jalan();
    const mo = new MutationObserver((muts) => {
      // Hanya penambahan/penghapusan elemen (atribut buatan kita tidak diamati).
      if (muts.some((m) => m.type === "childList")) jadwal();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, []);
  return null;
}
