import { describe, expect, it } from "vitest";
import { decalageParallaxe, inclinaison, longueurTournee, progressionArrets, raisonRepli, tracerTournee } from "@/lib/vitrine/scene";

const ok = { mouvementReduit: false, coeurs: 8, memoireGo: 8, economieDonnees: false, css3d: true };

describe("raisonRepli", () => {
  it("anime sur un appareil puissant", () => {
    expect(raisonRepli(ok)).toBeNull();
  });
  it("anime quand les capacités ne sont pas exposées (Safari, Firefox)", () => {
    expect(raisonRepli({ mouvementReduit: false })).toBeNull();
  });
  it("replie si l'utilisateur réduit les animations, même sur machine puissante", () => {
    expect(raisonRepli({ ...ok, mouvementReduit: true })).toBe("mouvement-reduit");
  });
  it("replie à 4 cœurs ou moins", () => {
    expect(raisonRepli({ ...ok, coeurs: 4 })).toBe("faible-puissance");
    expect(raisonRepli({ ...ok, coeurs: 5 })).toBeNull();
  });
  it("replie à 4 Go de mémoire ou moins", () => {
    expect(raisonRepli({ ...ok, memoireGo: 4 })).toBe("faible-puissance");
    expect(raisonRepli({ ...ok, memoireGo: 0.5 })).toBe("faible-puissance");
  });
  it("replie en mode économie de données", () => {
    expect(raisonRepli({ ...ok, economieDonnees: true })).toBe("economie-donnees");
  });
  it("replie sans CSS 3D", () => {
    expect(raisonRepli({ ...ok, css3d: false })).toBe("3d-indisponible");
  });
  it("ignore les valeurs nulles ou nulles de zéro (non renseignées)", () => {
    expect(raisonRepli({ ...ok, coeurs: 0, memoireGo: null })).toBeNull();
  });
});

describe("tracerTournee", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
    { x: 200, y: 0 },
  ];
  it("renvoie un chemin vide sans point", () => {
    expect(tracerTournee([])).toBe("");
  });
  it("commence au premier arrêt, finit au dernier, une courbe par tronçon", () => {
    const d = tracerTournee(pts);
    expect(d.startsWith("M0 0")).toBe(true);
    expect(d.endsWith("200 0")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
  });
  it("est déterministe", () => {
    expect(tracerTournee(pts)).toBe(tracerTournee(pts));
  });
  it("tension 0 : poignées sur les extrémités des tronçons", () => {
    expect(tracerTournee(pts.slice(0, 2), 0)).toBe("M0 0 C0 0 100 50 100 50");
  });
});

describe("progressionArrets", () => {
  it("croît de 0 à 1", () => {
    const p = progressionArrets([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 60, y: 80 }]);
    expect(p).toEqual([0, 0.5, 1]);
  });
  it("gère les points confondus", () => {
    expect(progressionArrets([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([0, 0]);
  });
  it("longueur de la ligne brisée", () => {
    expect(longueurTournee([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
  });
});

describe("inclinaison", () => {
  const rect = { left: 100, top: 100, width: 200, height: 100 };
  it("est nulle au centre", () => {
    expect(inclinaison(200, 150, rect)).toEqual({ rx: 0, ry: 0 });
  });
  it("penche vers le coin visé, bornée à l'angle max", () => {
    expect(inclinaison(300, 200, rect, 10)).toEqual({ rx: -10, ry: 10 });
    expect(inclinaison(9999, -9999, rect, 10)).toEqual({ rx: 10, ry: 10 });
  });
  it("ignore un rectangle vide", () => {
    expect(inclinaison(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ rx: 0, ry: 0 });
  });
});

describe("decalageParallaxe", () => {
  it("est nul quand l'élément est centré dans la fenêtre", () => {
    expect(decalageParallaxe(350, 100, 800, 40)).toBe(0);
  });
  it("monte quand l'élément entre par le bas, descend en sortant par le haut", () => {
    expect(decalageParallaxe(800, 100, 800, 40)).toBeGreaterThan(0);
    expect(decalageParallaxe(-100, 100, 800, 40)).toBeLessThan(0);
  });
  it("reste borné par la profondeur", () => {
    expect(Math.abs(decalageParallaxe(5000, 100, 800, 40))).toBe(40);
    expect(decalageParallaxe(0, 0, 0, 40)).toBe(0);
  });
});
