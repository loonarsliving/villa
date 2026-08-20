"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Role, SessionUser } from "./types";

interface AuthState {
  user: SessionUser | null;
  token: string | null;
  ready: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({ user: null, token: null, ready: false, logout: () => {} });

// SECURITY NOTE (see also proxy.ts and src/app/login/page.tsx):
// `villa_token`/`villa_user` in localStorage and the `villa_role` cookie set
// at login are both fully client-controlled -- nothing here proves to the
// server that the caller actually holds a valid session for that role. This
// component (plus proxy.ts) only gates the *Next.js page shell*: it
// stops the shell/route from rendering before a client-visible auth signal
// is present, and it stops this app's own effects from firing a data fetch
// before that check runs. It is NOT a substitute for server-side
// authorization. Every real authorization decision -- "does this token
// belong to an active user", "is this user allowed to see/mutate this
// unit/booking/report" -- MUST be (and, per the villa-api source, already
// is expected to be) enforced by the villa-api Supabase Edge Function on
// every request, by validating `x-villa-token` and the resource's
// ownership/role server-side. A user can always forge localStorage/cookies
// in devtools and bypass every check in this file; that is only harmless if
// villa-api independently rejects the resulting API calls.
export function AuthProvider({ children, requireRole }: { children: ReactNode; requireRole?: Role[] }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("villa_token");
    const raw = localStorage.getItem("villa_user");
    const u = raw ? (JSON.parse(raw) as SessionUser) : null;
    if (!t || !u) {
      setDenied(true);
      router.replace("/login");
      return;
    }
    if (requireRole && !requireRole.includes(u.role)) {
      setDenied(true);
      router.replace(roleHome(u.role));
      return;
    }
    setToken(t);
    setUser(u);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    localStorage.clear();
    clearRoleCookie();
    router.replace("/login");
  }

  // Do not mount `children` (and therefore do not run any of their data-fetching
  // effects) until the client-side auth/role check above has actually passed.
  // Previously `children` rendered unconditionally, so pages under
  // /admin, /investor and /front-desk could fire their `api.get(...)` calls
  // in the same tick as (or before) the redirect below took effect.
  if (!ready) {
    return denied ? null : (
      <div className="min-h-screen flex items-center justify-center text-ink/30 text-xs tracking-wide">Memuat…</div>
    );
  }

  return <AuthContext.Provider value={{ user, token, ready, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function roleHome(role: Role): string {
  if (role === "receptionist") return "/front-desk";
  if (role === "admin") return "/admin";
  return "/investor";
}

// Non-httpOnly, client-set cookie carrying only the current user's role.
// It is set right after login (see src/app/login/page.tsx) purely so that
// proxy.ts can redirect unauthenticated/unauthorized requests to
// /admin, /investor and /front-desk *before* Next.js renders the page
// shell for them (a client-side useEffect can only redirect after the
// shell already rendered). It carries no authorization weight by itself --
// it is exactly as spoofable as localStorage -- so proxy.ts only uses it
// to short-circuit the *obviously* unauthenticated/mismatched-role cases;
// villa-api still must independently verify every request.
export function setRoleCookie(role: Role) {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `villa_role=${role}; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax${secure}`;
}

export function clearRoleCookie() {
  if (typeof document === "undefined") return;
  document.cookie = "villa_role=; Path=/; Max-Age=0; SameSite=Lax";
}
