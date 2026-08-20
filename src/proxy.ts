import { NextResponse, type NextRequest } from "next/server";
import type { Role } from "@/lib/types";

// SECURITY NOTE: this proxy runs on the server (Vercel Edge), so it
// stops Next.js from ever rendering/sending the /admin, /investor or
// /front-desk page shell for a request that doesn't carry a `villa_role`
// cookie matching the route -- an improvement over the previous
// client-side-only useEffect redirect in src/lib/auth.tsx, which always
// shipped the page shell first and only redirected after hydration.
//
// It is still NOT real authorization. `villa_role` is a plain, non-httpOnly
// cookie set by client JS right after login (see src/app/login/page.tsx /
// src/lib/auth.tsx) -- it is exactly as forgeable as localStorage, since
// this app has no server-verifiable session (no server-readable secret, no
// endpoint here to verify the `villa_token` against villa-api). Anyone can
// set `document.cookie = "villa_role=admin"` in devtools and pass this
// check. Real per-request authorization (does this token belong to an
// active session, is this role/unit allowed to touch this resource) MUST
// happen in the villa-api Supabase Edge Function on every request -- that
// backend is not part of this repository, so it cannot be fixed here.
// This proxy only narrows the client-side-only gap, it does not close it.

const ROUTE_ROLES: Record<string, Role[]> = {
  "/admin": ["admin"],
  "/investor": ["owner"],
  "/front-desk": ["receptionist", "admin"],
};

function roleHome(role: Role): string {
  if (role === "receptionist") return "/front-desk";
  if (role === "admin") return "/admin";
  return "/investor";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const prefix = Object.keys(ROUTE_ROLES).find((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!prefix) return NextResponse.next();

  const role = request.cookies.get("villa_role")?.value as Role | undefined;
  const allowed = ROUTE_ROLES[prefix];

  if (!role) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (!allowed.includes(role)) {
    const url = request.nextUrl.clone();
    url.pathname = roleHome(role);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/investor/:path*", "/front-desk/:path*"],
};
