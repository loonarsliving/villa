"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, api, ApiError } from "@/lib/api";
import { roleHome, setRoleCookie } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";

type Step = "login" | "newpass" | "profile";

const shellCls = "relative z-10 w-full max-w-[400px] p-8 sm:p-11 border border-ink/10 rounded-lg bg-ink/[0.02] backdrop-blur-xl";
const labelCls = "block text-[10px] font-medium text-ink/40 tracking-[0.15em] uppercase mb-2";
const inputCls =
  "w-full py-3 border-0 border-b border-ink/15 bg-transparent text-sm text-ink outline-none focus:border-gold-500 transition-colors mb-6 placeholder:text-ink/20";
const btnCls =
  "w-full py-3.5 bg-gold-500 hover:opacity-90 disabled:opacity-60 text-base-950 rounded font-semibold text-[11.5px] tracking-[0.08em] uppercase transition-opacity";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [np1, setNp1] = useState("");
  const [np2, setNp2] = useState("");
  const [pfNama, setPfNama] = useState("");
  const [pfHp, setPfHp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);

  function finish(u: SessionUser) {
    localStorage.setItem("villa_user", JSON.stringify(u));
    // Lets proxy.ts recognize the session and gate routes server-side
    // before the page shell renders. See src/lib/auth.tsx for caveats.
    setRoleCookie(u.role);
    router.replace(roleHome(u.role));
  }

  async function handleLogin() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      const data = await login(email.trim(), password);
      localStorage.setItem("villa_token", data.token);
      localStorage.setItem("villa_user", JSON.stringify(data.user));
      setUser(data.user);
      if (data.user.must_change_password) {
        setStep("newpass");
      } else {
        finish(data.user);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Terjadi kesalahan, coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  async function handleNewPassword() {
    setError("");
    if (np1.length < 12 || np1 !== np2) {
      setError("Password tidak cocok atau terlalu pendek (minimal 12 karakter).");
      return;
    }
    setLoading(true);
    try {
      await api.post("/me/password", { password: np1 });
      const updated = { ...user!, must_change_password: false };
      setUser(updated);
      if (updated.role === "owner") {
        setStep("profile");
      } else {
        finish(updated);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleProfile() {
    setError("");
    if (!pfNama.trim() || !pfHp.trim()) {
      setError("Nama dan nomor HP wajib diisi.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/me/investor-profile", { nama: pfNama.trim(), hp: pfHp.trim() });
      finish({ ...user!, nama: pfNama.trim() });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan profil.");
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

      {step === "login" && (
        <div className={shellCls}>
          <div className="mb-9">
            <div className="font-serif text-[11px] font-normal text-ink/40 tracking-[0.35em] uppercase mb-2.5">
              Loonars Private Living
            </div>
            <div className="font-serif text-3xl font-light text-ink leading-tight">
              Portal <em className="not-italic text-gold-500 italic">Investor</em>, Manajemen
              <br />& Resepsionis
            </div>
            <div className="w-8 h-px bg-gold-500 my-5" />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
          >
            <label className={labelCls}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@domain.id" className={inputCls} />
            <label className={labelCls}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={`${inputCls} mb-7`} />
            <button type="submit" disabled={loading} className={btnCls}>
              {loading ? "Memproses..." : "Masuk"}
            </button>
            {error && <div className="text-xs text-ruby-400 mt-3.5 text-center tracking-wide">{error}</div>}
          </form>
        </div>
      )}

      {step === "newpass" && (
        <div className={shellCls}>
          <div className="mb-9">
            <div className="font-serif text-[11px] font-normal text-ink/40 tracking-[0.35em] uppercase mb-2.5">
              Loonars Private Living
            </div>
            <div className="font-serif text-3xl font-light text-ink leading-tight">
              Buat <em className="not-italic text-gold-500 italic">Password</em>
              <br />Baru
            </div>
            <div className="w-8 h-px bg-gold-500 my-5" />
          </div>
          <div className="text-xs text-ink/50 leading-relaxed mb-6">
            Ini login pertama Anda. Buat password baru sebelum melanjutkan ke dashboard.
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleNewPassword();
            }}
          >
            <label className={labelCls}>Password Baru</label>
            <input type="password" value={np1} onChange={(e) => setNp1(e.target.value)} placeholder="Minimal 12 karakter" className={inputCls} />
            <label className={labelCls}>Ulangi Password Baru</label>
            <input type="password" value={np2} onChange={(e) => setNp2(e.target.value)} placeholder="••••••••" className={`${inputCls} mb-7`} />
            <button type="submit" disabled={loading} className={btnCls}>
              {loading ? "Menyimpan..." : "Simpan & Lanjutkan"}
            </button>
            {error && <div className="text-xs text-ruby-400 mt-3.5 text-center tracking-wide">{error}</div>}
          </form>
        </div>
      )}

      {step === "profile" && (
        <div className={shellCls}>
          <div className="mb-9">
            <div className="font-serif text-[11px] font-normal text-ink/40 tracking-[0.35em] uppercase mb-2.5">
              Loonars Private Living
            </div>
            <div className="font-serif text-3xl font-light text-ink leading-tight">
              Data <em className="not-italic text-gold-500 italic">Investor</em>
              <br />Unit {user?.unit_nomor}
            </div>
            <div className="w-8 h-px bg-gold-500 my-5" />
          </div>
          <div className="text-xs text-ink/50 leading-relaxed mb-6">
            Lengkapi data Anda sebagai investor unit ini — tersimpan permanen sebagai arsip kepemilikan.
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleProfile();
            }}
          >
            <label className={labelCls}>Nama Lengkap</label>
            <input type="text" value={pfNama} onChange={(e) => setPfNama(e.target.value)} placeholder="Nama sesuai identitas" className={inputCls} />
            <label className={labelCls}>Nomor HP / WhatsApp</label>
            <input type="text" value={pfHp} onChange={(e) => setPfHp(e.target.value)} placeholder="+62 8xx-xxxx-xxxx" className={`${inputCls} mb-7`} />
            <button type="submit" disabled={loading} className={btnCls}>
              {loading ? "Menyimpan..." : "Simpan & Masuk Dashboard"}
            </button>
            {error && <div className="text-xs text-ruby-400 mt-3.5 text-center tracking-wide">{error}</div>}
          </form>
        </div>
      )}

      <div className="absolute bottom-6 right-6 font-serif text-[10px] text-ink/15 tracking-[0.2em] uppercase hidden sm:block">
        PT. Maha Karya Haluoleo
      </div>
    </div>
  );
}
