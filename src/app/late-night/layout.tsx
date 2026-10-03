"use client";

import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";

/**
 * Modul late night: role late_night (Laila) dan admin.
 *
 * Sengaja TIDAK memakai requireRole: AuthProvider mengalihkan role yang salah
 * ke dashboard-nya sendiri, padahal di latenight.loonars.id middleware
 * mengembalikan setiap halaman lain ke /late-night -- hasilnya putaran
 * pengalihan tanpa akhir. Akun lain cukup melihat penolakan di sini.
 */
export default function LateNightLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Gerbang>{children}</Gerbang>
    </AuthProvider>
  );
}

function Gerbang({ children }: { children: ReactNode }) {
  const { user, ready, logout } = useAuth();
  if (!ready || !user) return null;
  if (user.role !== "late_night" && user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="font-serif text-xl text-ink mb-2">Tidak ada akses</div>
          <p className="text-[12px] text-ink/50 mb-5">Halaman late night hanya untuk akun Late Night. Silakan masuk dengan akun yang benar.</p>
          <button onClick={logout} className="px-4 py-2 rounded bg-gold-500 text-base-950 text-[11.5px] font-semibold">
            Keluar
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
