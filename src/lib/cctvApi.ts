"use client";

/**
 * Client for the CCTV module's own Next.js API routes (src/app/api/cctv/*,
 * separate from src/lib/api.ts which talks to the external villa-api Edge
 * Function). Every request carries the logged-in user's id so the route can
 * re-verify it server-side against villa_users (see cctvGuard.ts).
 */

class CctvApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, userId: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/cctv${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-villa-user-id": userId,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new CctvApiError((data && data.error) || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export const cctvApi = {
  get: <T>(path: string, userId: string) => request<T>(path, userId),
  post: <T>(path: string, userId: string, body?: unknown) =>
    request<T>(path, userId, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, userId: string, body?: unknown) =>
    request<T>(path, userId, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
};
