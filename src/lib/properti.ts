"use client";

import { useEffect, useState } from "react";

/**
 * Properti yang sedang dipilih admin/finance (owner 2026-11-04: "ketika admin
 * atau finance login, langsung muncul pilihan dia mau memilih properti
 * mana"). Disimpan per browser; manager/resepsionis memakai properti akunnya.
 */
export interface Properti {
  kode: string;
  nama: string;
  aktif: boolean;
}

export const PROPERTI_PL: Properti = { kode: "PL", nama: "Loonars Private Living", aktif: true };
const KUNCI = "villa_properti";

export function propertiTerpilih(): Properti {
  try {
    const raw = localStorage.getItem(KUNCI);
    const p = raw ? (JSON.parse(raw) as Properti) : null;
    return p?.kode ? p : PROPERTI_PL;
  } catch {
    return PROPERTI_PL;
  }
}

export function simpanProperti(p: Properti) {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(p));
  } catch {
    // mode privat: pilihan tidak tersimpan, tetap jalan dengan bawaan
  }
}

export function usePropertiTerpilih(): Properti {
  const [p, setP] = useState<Properti>(PROPERTI_PL);
  useEffect(() => setP(propertiTerpilih()), []);
  return p;
}

/** Halaman awal setelah memilih properti. null = fitur properti ini belum tersedia. */
export function berandaProperti(kode: string, role: string): string | null {
  if (kode === "PL") return role === "finance" ? "/finance" : "/admin";
  // EL memakai halaman Private Living dengan data EL (multi-properti).
  if (kode === "EL") return role === "finance" ? "/finance/pendapatan" : "/front-desk";
  return null;
}

/**
 * Properti yang sedang dikerjakan pengguna: properti akun (manager,
 * resepsionis) atau pilihan admin/finance. Dipakai halaman bersama untuk
 * menyesuaikan menu dan teks (mis. tata tertib check-in EL).
 */
export function usePropertiAktif(user: { role: string; property_kode?: string | null } | null): string {
  const pilihan = usePropertiTerpilih();
  if (!user) return "PL";
  if (user.role === "admin" || user.role === "finance") return pilihan.kode;
  return user.property_kode || "PL";
}
