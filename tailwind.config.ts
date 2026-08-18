import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0a0a0b",
          900: "#ffffff",
          800: "#f1f2f5",
          700: "#e3e5ea",
          600: "#d1d4db",
        },
        canvas: "#f5f6f9",
        ink: "#14161b",
        gold: {
          400: "#d9b876",
          500: "#c4a05c",
          600: "#a8873f",
        },
        sage: {
          400: "#7fa382",
          500: "#5e8060",
          600: "#456147",
        },
        ruby: {
          400: "#e0706a",
          500: "#c0392b",
          600: "#9c2d21",
        },
        azure: {
          400: "#5b8def",
          500: "#2563eb",
          600: "#1d4fc4",
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
