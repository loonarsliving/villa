import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0a0a0b",
          900: "#111113",
          800: "#18181b",
          700: "#232326",
          600: "#2e2e33",
        },
        gold: {
          400: "#d9b876",
          500: "#c4a05c",
          600: "#a8873f",
        },
        sage: {
          400: "#7fa382",
          500: "#5e8060",
        },
        ruby: {
          400: "#e0706a",
          500: "#c0392b",
        },
        azure: {
          400: "#5b8def",
          500: "#2563eb",
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
