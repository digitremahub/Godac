import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Les 5 thèmes (Système, Clair, Sombre, Orange GODAC, Orange sombre)
 * passent par les variables de app/globals.css et les jetons Tailwind
 * (navy = encre, surface, paper, teal, orange, gold, *-ink, success).
 * Une couleur de la palette Tailwind écrite en dur (bg-red-50,
 * text-emerald-500…) ne suit pas le thème : pavé clair éblouissant dans
 * les thèmes sombres, ou texte illisible.
 */
const RACINE = path.resolve(__dirname, "../../..");
const PALETTE = /\b(?:[a-z-]+:)*(?:bg|text|border|ring|stroke|fill|from|via|to|divide|outline|accent|placeholder)-(?:red|green|emerald|amber|yellow|lime|blue|sky|indigo|violet|purple|pink|rose|gray|slate|zinc|neutral|stone|orange|teal|cyan)-\d{2,3}\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : sources(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("couleurs des 5 thèmes", () => {
  it("aucune couleur de la palette Tailwind écrite en dur dans l'application", () => {
    for (const f of [...sources(path.join(RACINE, "app")), ...sources(path.join(RACINE, "components"))]) {
      const m = readFileSync(f, "utf8").match(PALETTE);
      expect(m?.[0] ?? null, path.relative(RACINE, f)).toBeNull();
    }
  });

  it("pas de fond blanc fixe sous du texte à l'encre du thème (cartes, boîtes, listes)", () => {
    const fichiers = ["components/tours/TourRoutesBoard.tsx", "components/messenger/groupes/GroupInfoSheet.tsx", "components/messenger/groupes/CreateGroupButton.tsx", "components/colis/AffecterTournee.tsx", "components/fuel/FuelEntryDetail.tsx", "components/dashboard/DriverRecoveryCodePanel.tsx"];
    for (const f of fichiers) {
      const s = readFileSync(path.join(RACINE, f), "utf8");
      expect(/\bbg-white\b(?!\/)[^"`]*\btext-navy\b|\bborder-navy\/\d+ bg-white\b|rounded-t-2xl bg-white\b/.test(s), f).toBe(false);
    }
  });

  it("le jeton « success » existe pour chaque thème", () => {
    const css = readFileSync(path.join(RACINE, "app/globals.css"), "utf8");
    expect(css).toContain("--c-success:");
    expect(readFileSync(path.join(RACINE, "tailwind.config.ts"), "utf8")).toContain('success: "rgb(var(--c-success) / <alpha-value>)"');
  });
});
