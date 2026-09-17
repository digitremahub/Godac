import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0A0F1E",
        paper: "#F6F7FB",
        teal: "#1BE4C1",
        orange: "#FF6B35",
        gold: "#F5C842",
        // Deep, readable variants of the three brand accents — the
        // bright versions above have poor contrast as *text* on the
        // light theme's white/paper background (they're kept as-is
        // for fills: buttons, badge backgrounds, accent bars, where
        // it's the shape's own contrast that matters, not the page's).
        "teal-ink": "#0F766E",
        "orange-ink": "#C2410C",
        "gold-ink": "#92660A",
      },
      fontFamily: {
        display: ["var(--font-heading)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
