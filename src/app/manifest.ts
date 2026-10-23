import type { MetadataRoute } from "next";

/**
 * Manifest aplikasi (owner 2026-10-23): supaya "Add to Home Screen" di
 * iPhone menjadi aplikasi penuh -- syarat iOS untuk Web Push dan angka
 * belum-dibaca di ikon. start_url "/" diarahkan ke beranda sesuai peran
 * (src/app/page.tsx).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Loonars Private Living",
    short_name: "Loonars Living",
    description: "Portal Investor & Operasional — Loonars Private Living",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f9",
    theme_color: "#456147",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
