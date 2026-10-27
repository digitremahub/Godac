import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contrastes des blocs orange de la vitrine, lus dans app/globals.css
// (valeurs réellement servies). Seuil WCAG AA : 4,5:1 pour le texte.
const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");

type Rgb = [number, number, number];

function bloc(selecteur: string): Record<string, Rgb> {
  const debut = css.indexOf(`${selecteur} {`);
  if (debut < 0) throw new Error(`Bloc introuvable : ${selecteur}`);
  const corps = css.slice(debut, css.indexOf("}", debut));
  const vars: Record<string, Rgb> = {};
  for (const m of corps.matchAll(/--(c-[a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) {
    vars[m[1] ?? ""] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return vars;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a: Rgb, b: Rgb): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
const BLANC: Rgb = [255, 255, 255];
const clair = bloc(":root");
const sombre = { ...clair, ...bloc(":root[data-theme=\"dark\"]") };
const sombreSysteme = { ...clair, ...bloc(":root:not([data-theme])") };
const orangeSombre = { ...clair, ...bloc(":root[data-theme=\"orange-dark\"]") };

describe("blocs orange de la vitrine", () => {
  it("orange foncé : texte blanc plein ≥ 4,5:1, identique dans tous les thèmes", () => {
    expect(clair["c-orange-fonce"]).toEqual([194, 65, 12]);
    for (const t of [clair, sombre, sombreSysteme, orangeSombre]) {
      expect(ratio(BLANC, t["c-orange-fonce"]!)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("orange clair (mode clair) : encre et texte d'accent lisibles, sur le fond et sur les cartes", () => {
    const fond = clair["c-orange-clair"]!;
    expect(ratio(clair["c-ink"]!, fond)).toBeGreaterThanOrEqual(AA);
    expect(ratio(clair["c-orange-texte"]!, fond)).toBeGreaterThanOrEqual(AA);
    expect(ratio(clair["c-orange-texte"]!, clair["c-surface"]!)).toBeGreaterThanOrEqual(AA);
  });

  it("orange clair (mode sombre) : suit le thème sombre, texte lisible", () => {
    for (const t of [sombre, sombreSysteme, orangeSombre]) {
      const fond = t["c-orange-clair"]!;
      expect(fond).not.toEqual(clair["c-orange-clair"]);
      expect(ratio(t["c-ink"]!, fond)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t["c-orange-texte"]!, fond)).toBeGreaterThanOrEqual(AA);
      expect(ratio(t["c-orange-texte"]!, t["c-surface"]!)).toBeGreaterThanOrEqual(AA);
    }
  });
});
