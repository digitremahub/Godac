import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    // lib/organization/poles.ts porte les pastilles de couleur des pôles.
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware tokens (app/globals.css): `navy` is the INK — dark
        // text in light mode, light text in dark mode — and `paper` /
        // `surface` the page and card backgrounds. `marine` is the brand
        // navy as a FILL (sidebar, heroes, dark buttons) and never flips.
        navy: "rgb(var(--c-ink) / <alpha-value>)",
        paper: "rgb(var(--c-paper) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        marine: "#0A0F1E",
        // Accent fills, as variables so the Orange GODAC theme can swap
        // them (teal → orange GODAC, orange → rouge framboise). Defaults
        // #1BE4C1 / #FF6B35 in app/globals.css.
        teal: "rgb(var(--c-teal) / <alpha-value>)",
        orange: "rgb(var(--c-orange) / <alpha-value>)",
        gold: "#F5C842",
        // Points relais (tournée colis) : violet, distinct de l'or des ramasses.
        relais: "#A78BFA",
        // Readable text variants of the three accents: deep on light
        // backgrounds, bright on dark ones (fills keep the brand hues).
        "teal-ink": "rgb(var(--c-teal-ink) / <alpha-value>)",
        "orange-ink": "rgb(var(--c-orange-ink) / <alpha-value>)",
        "gold-ink": "rgb(var(--c-gold-ink) / <alpha-value>)",
        "relais-ink": "rgb(var(--c-relais-ink) / <alpha-value>)",
        // Succès (présence, validé) : distinct de l'accent dans les thèmes
        // Orange GODAC (vert), égal au teal sinon (app/globals.css).
        success: "rgb(var(--c-success) / <alpha-value>)",
        "success-ink": "rgb(var(--c-success-ink) / <alpha-value>)",
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
