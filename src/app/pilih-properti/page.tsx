"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { localApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { berandaProperti, propertiTerpilih, simpanProperti, type Properti } from "@/lib/properti";

/**
 * Admin & finance memilih properti setelah login (owner 2026-11-04). Pilihan
 * disimpan di browser dan bisa diganti kapan saja lewat menu "Ganti Properti".
 */
export default function PilihPropertiPage() {
  const router = useRouter();
  const { user, ready, logout } = useAuth();
  const [daftar, setDaftar] = useState<Properti[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [belumSiap, setBelumSiap] = useState<Properti | null>(null);
  const [sekarang, setSekarang] = useState<string>("PL");

  useEffect(() => {
    if (!ready) return;
    setSekarang(propertiTerpilih().kode);
    localApi<Properti[]>("/api/properti")
      .then((r) => setDaftar(r.filter((p) => p.aktif)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ready]);

  function pilih(p: Properti) {
    if (!user) return;
    simpanProperti(p);
    const tujuan = berandaProperti(p.kode, user.role, p.siap === true);
    if (!tujuan) {
      // Admin langsung diarahkan menyelesaikan pengaturan properti baru (tanpa coding).
      if (user.role === "admin") {
        router.replace(`/admin/properti/${p.kode}`);
        return;
      }
      setBelumSiap(p);
      return;
    }
    router.replace(tujuan);
  }

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-ink/50 text-xs">Memuat sesi...</div>;
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="text-[10px] font-medium text-gold-500 tracking-[0.25em] uppercase">Loonars</div>
        <h1 className="font-serif text-3xl font-light text-ink mt-1">Pilih Properti</h1>
        <p className="text-[12.5px] text-ink/50 mt-2">
          Halo {user?.nama ?? ""}. Pilih properti yang ingin Anda kelola. Bisa diganti kapan saja dari menu &ldquo;Ganti Properti&rdquo;.
        </p>

        <div className="mt-6 space-y-3">
          {error && <div className="text-[12px] text-ruby-500">Gagal memuat properti: {error}</div>}
          {!daftar && !error && <div className="text-[12px] text-ink/40">Memuat properti...</div>}
          {daftar?.map((p) => (
            <button
              key={p.kode}
              onClick={() => pilih(p)}
              className={`w-full text-left rounded-xl border px-5 py-4 transition hover:border-gold-500/60 ${
                p.kode === sekarang ? "border-gold-500/50 bg-gold-500/5" : "border-ink/10 bg-base-900 shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-serif text-lg text-ink">{p.nama}</div>
                  <div className="text-[11px] text-ink/40 tracking-wide">Kode {p.kode}</div>
                </div>
                <span className="text-gold-500 text-lg">→</span>
              </div>
            </button>
          ))}
        </div>

        {belumSiap && (
          <div className="mt-5 rounded-xl bg-gold-500/10 px-4 py-3 text-[12px] text-gold-600">
            <b>{belumSiap.nama}</b> sudah terdaftar, tetapi fitur operasionalnya (kamar, booking, finance) belum aktif untuk properti ini.
            Sementara ini Anda bisa mengatur karyawannya di Admin &rarr; Pengguna.
            {user?.role === "admin" && (
              <button className="ml-2 underline" onClick={() => router.push("/admin/users")}>
                Buka Pengguna
              </button>
            )}
          </div>
        )}

        <button onClick={logout} className="mt-8 text-[11px] text-ink/40 underline">
          Keluar
        </button>
      </div>
    </div>
  );
}
