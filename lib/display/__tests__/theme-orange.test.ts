import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DISPLAY_PREFERENCES_SCRIPT, parseThemePreference } from "@/lib/display/preferences";

// Les couleurs sont lues directement dans app/globals.css : le test
// vérifie donc les valeurs réellement servies, pas une copie.
const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");

type Rgb = [number, number, number];

/** Variables « --c-x: r g b; » d'un bloc CSS dont on donne le sélecteur exact. */
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

const defaut = bloc(":root");

/** Couleurs d'un thème : valeurs par défaut de :root, surchargées par le bloc. */
function theme(selecteur: string) {
  const vars = selecteur === ":root" ? defaut : { ...defaut, ...bloc(selecteur) };
  return (nom: string): Rgb => {
    const c = vars[nom];
    if (!c) throw new Error(`--${nom} absente de ${selecteur}`);
    return c;
  };
}

const BLANC: Rgb = [255, 255, 255];
const MARINE: Rgb = [10, 15, 30];

/** Luminance relative WCAG 2.x, 0 (noir) à 1 (blanc). */
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

/** Couleur `c` à l'opacité `alpha` posée sur `fond` (bg-teal/[0.12]…). */
function melange(c: Rgb, alpha: number, fond: Rgb): Rgb {
  const m = (i: 0 | 1 | 2) => Math.round(c[i] * alpha + fond[i] * (1 - alpha));
  return [m(0), m(1), m(2)];
}

/** Teinte HSL en degrés. */
function teinte([r, g, b]: Rgb): number {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  if (d === 0) return 0;
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return (h * 60 + 360) % 360;
}

function ecartTeinte(a: Rgb, b: Rgb): number {
  const d = Math.abs(teinte(a) - teinte(b));
  return Math.min(d, 360 - d);
}

const AA = 4.5;

describe("thème Orange GODAC (clair)", () => {
  const t = theme(':root[data-theme="orange"]');

  it("garde le texte marine sur un papier chaud", () => {
    expect(t("c-ink")).toEqual(MARINE);
    expect(t("c-paper")).not.toEqual(theme(":root")("c-paper"));
    expect(ratio(t("c-ink"), t("c-paper"))).toBeGreaterThanOrEqual(AA);
  });

  it("met l'orange GODAC en accent (teal → #FF6B35, texte #C2410C)", () => {
    expect(t("c-teal")).toEqual([255, 107, 53]);
    expect(t("c-teal-ink")).toEqual([194, 65, 12]);
  });

  it("texte orange-ink lisible sur le papier, les cartes et les pastilles", () => {
    expect(ratio(t("c-teal-ink"), t("c-paper"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(t("c-teal-ink"), t("c-surface"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(t("c-teal-ink"), melange(t("c-teal"), 0.12, t("c-surface")))).toBeGreaterThanOrEqual(AA);
  });

  it("boutons : marine sur orange GODAC, blanc sur orange-ink et sur le rouge", () => {
    expect(ratio(MARINE, t("c-teal"))).toBeGreaterThanOrEqual(AA); // btn-primary
    expect(ratio(MARINE, t("c-teal-hover"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(BLANC, t("c-teal-ink"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(BLANC, t("c-orange"))).toBeGreaterThanOrEqual(AA); // btn-danger
    expect(ratio(BLANC, t("c-orange-hover"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(BLANC, t("c-orange-ink"))).toBeGreaterThanOrEqual(AA);
  });

  it("textes d'état lisibles (erreur, succès, alerte, relais)", () => {
    for (const k of ["c-orange-ink", "c-success-ink", "c-gold-ink", "c-relais-ink"]) {
      expect(ratio(t(k), t("c-paper")), k).toBeGreaterThanOrEqual(AA);
      expect(ratio(t(k), t("c-surface")), k).toBeGreaterThanOrEqual(AA);
    }
    expect(ratio(t("c-orange-ink"), melange(t("c-orange"), 0.12, t("c-surface")))).toBeGreaterThanOrEqual(AA);
    expect(ratio(t("c-success-ink"), melange(t("c-success"), 0.12, t("c-surface")))).toBeGreaterThanOrEqual(AA);
  });

  it("l'erreur et le succès restent distincts de l'accent orange", () => {
    expect(ecartTeinte(t("c-orange"), t("c-teal"))).toBeGreaterThanOrEqual(25);
    expect(ecartTeinte(t("c-orange-ink"), t("c-teal-ink"))).toBeGreaterThanOrEqual(25);
    expect(ecartTeinte(t("c-success"), t("c-teal"))).toBeGreaterThanOrEqual(90);
  });
});

describe("thème Orange sombre", () => {
  const t = theme(':root[data-theme="orange-dark"]');

  it("texte clair et accents lisibles sur le fond sombre", () => {
    for (const k of ["c-ink", "c-teal-ink", "c-orange-ink", "c-success-ink", "c-gold-ink", "c-relais-ink"]) {
      expect(ratio(t(k), t("c-paper")), k).toBeGreaterThanOrEqual(AA);
      expect(ratio(t(k), t("c-surface")), k).toBeGreaterThanOrEqual(AA);
    }
  });

  it("boutons : marine sur orange GODAC, blanc sur le rouge", () => {
    expect(ratio(MARINE, t("c-teal"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(BLANC, t("c-orange"))).toBeGreaterThanOrEqual(AA);
  });

  it("l'erreur reste distincte de l'accent", () => {
    expect(ecartTeinte(t("c-orange-ink"), t("c-teal-ink"))).toBeGreaterThanOrEqual(25);
  });
});

describe("préférence de thème", () => {
  it("reconnaît les deux thèmes orange et retombe sur « system » sinon", () => {
    expect(parseThemePreference("orange")).toBe("orange");
    expect(parseThemePreference("orange-dark")).toBe("orange-dark");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("violet")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("le script anti-flash du layout applique aussi les thèmes orange", () => {
    expect(DISPLAY_PREFERENCES_SCRIPT).toContain('"orange"');
    expect(DISPLAY_PREFERENCES_SCRIPT).toContain('"orange-dark"');
  });
});
