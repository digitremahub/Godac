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
      boxShadow: {
        card: "0 1px 2px 0 rgba(10,15,30,0.04), 0 1px 3px 0 rgba(10,15,30,0.03)",
        raised: "0 2px 4px -1px rgba(10,15,30,0.06), 0 12px 24px -8px rgba(10,15,30,0.12)",
        pop: "0 24px 48px -12px rgba(10,15,30,0.25)",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
