import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ToastProvider } from "@/lib/toast";
import { MotionProvider } from "@/components/MotionProvider";
import { MotionLayer } from "@/components/MotionLayer";

// Font disimpan di repo (src/app/fonts) agar build tidak bergantung pada Google
// Fonts -- next/font/google sesekali gagal di CI GitHub (2026-11-01).
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-body",
});
const cormorant = localFont({
  src: [
    { path: "./fonts/cormorant-garamond-latin-wght-normal.woff2", weight: "300 700", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-wght-italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-display",
});
const mono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Loonars Private Living",
  description: "Portal Investor & Operasional — Loonars Private Living",
  // iPhone "Add to Home Screen" sebagai aplikasi penuh -- syarat Web Push di iOS (2026-10-23).
  appleWebApp: { capable: true, title: "Loonars Living", statusBarStyle: "default" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={`${inter.variable} ${cormorant.variable} ${mono.variable} font-sans antialiased bg-canvas text-ink`}>
        <MotionProvider>
          <ToastProvider>{children}</ToastProvider>
          <MotionLayer />
        </MotionProvider>
      </body>
    </html>
  );
}
