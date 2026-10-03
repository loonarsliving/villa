import { NextResponse, type NextRequest } from "next/server";

/**
 * latenight.loonars.id -- subdomain khusus late night booking (owner
 * 2026-10-03), dilayani oleh aplikasi villa yang sama dengan
 * living.haluoleo.id. Di host itu hanya /login dan /late-night yang dibuka;
 * setiap halaman lain (termasuk /) dialihkan ke /late-night, supaya
 * subdomain ini tidak menjadi pintu kedua ke dashboard admin/resepsionis.
 *
 * Ini hanya merapikan arah halaman. Yang benar-benar menjaga datanya adalah
 * villa-api: role late_night ditolak di luar /late-night/*, dan rute
 * /late-night/* ditolak untuk role selain late_night dan admin.
 */
const HOST_LATE_NIGHT = "latenight.";

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!host.startsWith(HOST_LATE_NIGHT)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/late-night" || pathname.startsWith("/late-night/")) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/late-night";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Aset Next.js, rute API, dan berkas statis (ikon, gambar) tidak disentuh.
  matcher: ["/((?!_next/|api/|.*\\.[a-zA-Z0-9]+$).*)"],
};
