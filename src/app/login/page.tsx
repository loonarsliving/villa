"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, ApiError } from "@/lib/api";
import { roleHome } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      const data = await login(email.trim(), password);
      localStorage.setItem("villa_token", data.token);
      localStorage.setItem("villa_user", JSON.stringify(data.user));
      router.replace(roleHome(data.user.role));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Terjadi kesalahan, coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-4">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 60% 60% at 70% 40%, rgba(196,160,92,.08) 0%, transparent 70%)" }}
      />
      <div className="relative z-10 w-full max-w-[400px] p-8 sm:p-11 border border-white/10 rounded-lg bg-white/[0.02] backdrop-blur-xl">
        <div className="mb-9">
          <div className="font-serif text-[11px] font-normal text-white/40 tracking-[0.35em] uppercase mb-2.5">
            Loonars Private Living
          </div>
          <div className="font-serif text-3xl font-light text-white leading-tight">
            Portal <em className="not-italic text-gold-500 italic">Investor</em>
            <br />& Operasional
          </div>
          <div className="w-8 h-px bg-gold-500 my-5" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin();
          }}
        >
          <label className="block text-[10px] font-medium text-white/40 tracking-[0.15em] uppercase mb-2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@domain.id"
            className="w-full py-3 border-0 border-b border-white/15 bg-transparent text-sm text-white outline-none focus:border-gold-500 transition-colors mb-6 placeholder:text-white/20"
          />
          <label className="block text-[10px] font-medium text-white/40 tracking-[0.15em] uppercase mb-2">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full py-3 border-0 border-b border-white/15 bg-transparent text-sm text-white outline-none focus:border-gold-500 transition-colors mb-7 placeholder:text-white/20"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-gold-500 hover:opacity-90 disabled:opacity-60 text-base-950 rounded font-semibold text-[11.5px] tracking-[0.08em] uppercase transition-opacity"
          >
            {loading ? "Memproses..." : "Masuk"}
          </button>
          {error && <div className="text-xs text-ruby-400 mt-3.5 text-center tracking-wide">{error}</div>}
        </form>
      </div>
      <div className="absolute bottom-6 right-6 font-serif text-[10px] text-white/15 tracking-[0.2em] uppercase hidden sm:block">
        PT. Maha Karya Haluoleo
      </div>
    </div>
  );
}
