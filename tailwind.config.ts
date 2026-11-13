import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      // Palet "Loonars" (owner 2026-11-13: dirombak seperti loonars.id).
      // Nama kelas lama dipertahankan supaya semua halaman ikut berubah dari
      // sini: gold = aksen/aksi utama (kini terakota), sage = sukses (hijau
      // daun), ruby = bahaya (merah hangat), azure = info (biru-abu redup),
      // base/canvas/ink = kertas krem & tinta cokelat.
      colors: {
        base: {
          950: "#1f2d22",
          900: "#fffdf9",
          800: "#f3ece0",
          700: "#e8dece",
          600: "#d8cab3",
        },
        canvas: "#f6f1e8",
        ink: "#2b2620",
        forest: "#1f2d22",
        cream: "#f6f1e8",
        gold: {
          400: "#c27a4f",
          500: "#b4693f",
          600: "#97532f",
          700: "#7a4226",
        },
        sage: {
          400: "#6f8b6a",
          500: "#4f6e55",
          600: "#3e5a44",
        },
        ruby: {
          400: "#c5614f",
          500: "#b0412f",
          600: "#8f3424",
        },
        azure: {
          400: "#6f93a8",
          500: "#4f7a91",
          600: "#3d6278",
        },
        // Beranda investor/admin (AppHome) memakai slate/blue bawaan Tailwind;
        // diganti versi hangat di sini supaya senada tanpa menyentuh tiap kelas.
        slate: {
          50: "#faf6ef", 100: "#f1e9dc", 200: "#e5d9c6", 300: "#d2c2a9", 400: "#a39580",
          500: "#7d705f", 600: "#5f5447", 700: "#4a4137", 800: "#352e27", 900: "#2b2620", 950: "#1c1814",
        },
        blue: {
          50: "#eef3ec", 100: "#dce7d8", 200: "#bccfb6", 300: "#94b08d", 400: "#6f8b6a",
          500: "#4f6e55", 600: "#3e5a44", 700: "#2d4433", 800: "#233528", 900: "#1f2d22", 950: "#141e17",
        },
      },
      fontFamily: {
        serif: ["var(--font-display)", "serif"],
        sans: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
