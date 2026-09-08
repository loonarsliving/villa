const API_BASE = "https://svcmybsziaelwwdrnzcv.supabase.co/functions/v1/villa-api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("villa_token");
}

/**
 * villa-api mints HMAC session tokens as `base64url(payload).signature` with a
 * 7-day `exp`. Reading `exp` here is a UX affordance only -- the signature is
 * never checked client-side, villa-api remains the sole authority. It lets the
 * app notice an expired session before firing a request that is certain to 401.
 */
export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  const body = token.split(".")[0];
  if (!body) return true;
  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp !== "number" || exp < Date.now();
  } catch {
    return true;
  }
}

/**
 * Ends a dead session and sends the user back to login.
 *
 * Without this, an expired token left the app in a stuck state: AuthProvider
 * only checks that localStorage HAS a token, so every page still rendered
 * while every request 401'd, showing "Gagal memuat: unauthorized" with no
 * indication that re-login was the fix.
 */
export function endSession(reason: "expired" | "unauthorized" = "expired"): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  localStorage.removeItem("villa_token");
  localStorage.removeItem("villa_user");
  window.location.replace(`/login?${reason}=1`);
}

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) endSession();
    throw new ApiError((data && data.error) || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-villa-token": token } : {}),
      ...(options.headers || {}),
    },
  });
  return parse<T>(res);
}

/**
 * Same contract as `request`, but for villa's own Next.js routes under /api/*
 * (revenue, pricing, CCTV, payment gateway). Those routes gate on the same
 * x-villa-token, so they need the same 401 handling -- previously each call
 * site inlined its own fetch and surfaced the raw "unauthorized" string.
 */
export async function localApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const hasBody = options.body !== undefined;
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "x-villa-token": token } : {}),
      ...(options.headers || {}),
    },
  });
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((data && data.error) || "Login gagal", res.status);
  return data as { token: string; user: import("./types").SessionUser };
}
