import { describe, expect, it } from "vitest";
import {
  BLANC,
  COULEURS_GODAC,
  ENCRE,
  FONDS,
  PALETTES,
  ajusterPourContraste,
  calculerTheme,
  canaux,
  contraste,
  cssCouleursEntreprise,
  hexVersRgb,
  lireCouleursEntreprise,
  luminance,
  remplissageLisible,
  rgbVersHex,
  texteSur,
} from "@/lib/theme/couleurs-entreprise";

describe("conversions et contraste", () => {
  it("hex ↔ rgb", () => {
    expect(hexVersRgb("#1BE4C1")).toEqual([27, 228, 193]);
    expect(rgbVersHex([27, 228, 193])).toBe("#1BE4C1");
    expect(canaux("#0A0F1E")).toBe("10 15 30");
  });

  it("luminance et contraste WCAG", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#FFFFFF")).toBe(1);
    expect(contraste("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contraste("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });

  it("ajusterPourContraste garde la couleur si elle suffit, sinon l'assombrit", () => {
    expect(ajusterPourContraste("#0F766E", FONDS.papierClair)).toBe("#0F766E");
    const jaune = ajusterPourContraste("#FFEB3B", FONDS.papierClair);
    expect(contraste(jaune, FONDS.papierClair)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(jaune)).toBeLessThan(luminance("#FFEB3B"));
  });

  it("éclaircit sur fond sombre", () => {
    const bleu = ajusterPourContraste("#1E3A8A", FONDS.surfaceSombre);
    expect(contraste(bleu, FONDS.surfaceSombre)).toBeGreaterThanOrEqual(4.5);
  });

  it("texteSur choisit blanc ou encre", () => {
    expect(texteSur("#1BE4C1").texte).toBe(ENCRE);
    expect(texteSur("#1E3A8A").texte).toBe(BLANC);
  });

  it("remplissageLisible ajuste une couleur intermédiaire", () => {
    // Gris moyen : ni le blanc ni l'encre n'atteignent 4,5:1.
    const r = remplissageLisible("#7A7A7A");
    expect(r.ajustee).toBe(true);
    expect(contraste(r.fond, r.texte)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("calculerTheme", () => {
  const couleursDifficiles = ["#FFFF00", "#FFC0CB", "#7A7A7A", "#00FF00", "#0000FF", "#000000", "#FFFFFF", "#E11D48", "#87CEEB"];

  it("toutes les variantes sont lisibles (AA), quelle que soit la couleur", () => {
    for (const c of couleursDifficiles) {
      const t = calculerTheme({ principale: c, secondaire: c, menu: c });
      for (const a of [t.principale, t.secondaire]) {
        expect(contraste(a.fond, a.texte), c).toBeGreaterThanOrEqual(4.5);
        expect(contraste(a.survol, a.texte), c).toBeGreaterThanOrEqual(4.5);
        expect(contraste(a.inkClair, FONDS.papierClair), c).toBeGreaterThanOrEqual(4.5);
        expect(contraste(a.inkClair, FONDS.surfaceClaire), c).toBeGreaterThanOrEqual(4.5);
        expect(contraste(a.inkSombre, FONDS.papierSombre), c).toBeGreaterThanOrEqual(4.5);
        expect(contraste(a.inkSombre, FONDS.surfaceSombre), c).toBeGreaterThanOrEqual(4.5);
      }
      expect(contraste(t.menu.fond, BLANC), c).toBeGreaterThanOrEqual(7);
      expect(contraste(t.menu.accent, t.menu.fond), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("les couleurs GODAC et les palettes prêtes ne demandent aucun ajustement", () => {
    expect(calculerTheme(COULEURS_GODAC).ajustements).toEqual([]);
    for (const p of PALETTES) expect(calculerTheme(p.couleurs).ajustements, p.nom).toEqual([]);
  });

  it("signale un ajustement à l'utilisateur", () => {
    const t = calculerTheme({ principale: "#7A7A7A", secondaire: "#FF6B35", menu: "#3B82F6" });
    expect(t.ajustements).toHaveLength(2);
    expect(t.ajustements[0]).toContain("Couleur principale");
    expect(t.ajustements[1]).toContain("Couleur du menu assombrie");
  });
});

describe("variables CSS", () => {
  it("couvre clair et sombre, laisse les thèmes orange", () => {
    const css = cssCouleursEntreprise({ principale: "#2563EB", secondaire: "#F59E0B", menu: "#0F172A" });
    expect(css).toContain("--c-marine:15 23 42");
    expect(css).toContain(':root:not([data-theme^="orange"])');
    expect(css).toContain("--c-teal:37 99 235");
    expect(css).toContain("@media (prefers-color-scheme: dark){:root:not([data-theme])");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).not.toContain("<");
  });

  it("lireCouleursEntreprise refuse les valeurs invalides", () => {
    expect(lireCouleursEntreprise(null)).toBeNull();
    expect(lireCouleursEntreprise({ principale: "red", secondaire: "#FFFFFF", menu: "#000000" })).toBeNull();
    expect(lireCouleursEntreprise({ principale: "#2563EB", secondaire: "#F59E0B", menu: "#0F172A" })).toEqual({ principale: "#2563EB", secondaire: "#F59E0B", menu: "#0F172A" });
  });
});
