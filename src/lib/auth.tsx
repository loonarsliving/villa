"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Role, SessionUser } from "./types";
import { isTokenExpired } from "./api";

interface AuthState {
  user: SessionUser | null;
  token: string | null;
  ready: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({ user: null, token: null, ready: false, logout: () => {} });

export function AuthProvider({ children, requireRole }: { children: ReactNode; requireRole?: Role[] }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("villa_token");
    const raw = localStorage.getItem("villa_user");
    const u = raw ? (JSON.parse(raw) as SessionUser) : null;
    if (!t || !u) {
      router.replace("/login");
      return;
    }
    // A token past its 7-day exp would render the whole shell and then 401 on
    // every request; bounce to login with an explanation instead.
    if (isTokenExpired(t)) {
      localStorage.removeItem("villa_token");
      localStorage.removeItem("villa_user");
      router.replace("/login?expired=1");
      return;
    }
    if (requireRole && !requireRole.includes(u.role)) {
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
    router.replace("/login");
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
