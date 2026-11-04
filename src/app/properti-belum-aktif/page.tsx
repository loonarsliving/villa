"use client";

import { AuthProvider, useAuth } from "@/lib/auth";

function Isi() {
  const { user, ready, logout } = useAuth();
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-ink/30 text-xs">Memuat sesi...</div>;
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="text-[10px] font-medium text-gold-500 tracking-[0.25em] uppercase">Loonars</div>
        <h1 className="font-serif text-2xl font-light text-ink mt-2">Fitur properti Anda belum aktif</h1>
        <p className="text-[12.5px] text-ink/50 mt-3">
          Halo {user?.nama ?? ""}. Akun Anda sudah terdaftar, tetapi halaman kerja untuk properti Anda belum dibuka.
          Admin perlu menyelesaikan pengaturan properti dulu. Setelah admin mengaktifkannya, keluar lalu masuk kembali.
        </p>
        <button onClick={logout} className="mt-6 text-[12px] text-gold-500 underline">
          Keluar
        </button>
      </div>
    </div>
  );
}

/** Untuk akun manager/resepsionis properti yang fitur operasionalnya belum tersedia (multi-properti 2026-11-04). */
export default function PropertiBelumAktifPage() {
  return (
    <AuthProvider>
      <Isi />
    </AuthProvider>
  );
}
