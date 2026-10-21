import { describe, expect, it } from "vitest";
import { FEUILLE_PAR_DEFAUT, HAUTEUR_REDUITE_PX, adresseCourte, decouperTrace, hauteurMaxFeuille, lirePositionFeuille, positionApresGeste, repeteAdresse } from "@/lib/colis/feuille";
import { margesConduite } from "@/lib/colis/conduite";

describe("positions de la feuille", () => {
  it("relit la position mémorisée (réduite / moyenne), sinon la position par défaut", () => {
    expect(lirePositionFeuille("moyenne")).toBe("moyenne");
    expect(lirePositionFeuille("reduite")).toBe("reduite");
    expect(lirePositionFeuille("pleine")).toBe(FEUILLE_PAR_DEFAUT);
    expect(lirePositionFeuille(null)).toBe(FEUILLE_PAR_DEFAUT);
    expect(FEUILLE_PAR_DEFAUT).toBe("reduite");
  });
  it("tirer vers le haut monte d'une position, vers le bas descend", () => {
    expect(positionApresGeste("reduite", -60)).toBe("moyenne");
    expect(positionApresGeste("moyenne", -60)).toBe("pleine");
    expect(positionApresGeste("pleine", -60)).toBe("pleine");
    expect(positionApresGeste("pleine", 60)).toBe("moyenne");
    expect(positionApresGeste("moyenne", 60)).toBe("reduite");
    expect(positionApresGeste("reduite", 60)).toBe("reduite");
  });
  it("un long glissement saute une position", () => {
    expect(positionApresGeste("reduite", -400, 800)).toBe("pleine");
    expect(positionApresGeste("pleine", 400, 800)).toBe("reduite");
  });
  it("un appui alterne réduite ↔ moyenne, la liste pleine redescend en moyenne", () => {
    expect(positionApresGeste("reduite", 0)).toBe("moyenne");
    expect(positionApresGeste("moyenne", 5)).toBe("reduite");
    expect(positionApresGeste("pleine", -3)).toBe("moyenne");
  });
  it("hauteurs : ligne de 72 à 88 px, ≈ 40 % puis 85 % de l'écran", () => {
    expect(HAUTEUR_REDUITE_PX).toBeGreaterThanOrEqual(72);
    expect(HAUTEUR_REDUITE_PX).toBeLessThanOrEqual(88);
    expect(hauteurMaxFeuille("reduite", 800)).toBe(HAUTEUR_REDUITE_PX);
    expect(hauteurMaxFeuille("moyenne", 800)).toBe(320);
    expect(hauteurMaxFeuille("moyenne", 400)).toBe(220);
    expect(hauteurMaxFeuille("pleine", 800)).toBe(680);
  });
  it("la caméra suit la hauteur de la feuille : la voiture reste au-dessus", () => {
    const reduite = margesConduite(800, 88, 140);
    const moyenne = margesConduite(800, 320, 140);
    expect(reduite.bottom).toBeLessThan(moyenne.bottom);
    // Voiture (centre de la zone utile) au-dessus de la feuille dans les deux cas.
    for (const [m, h] of [[reduite, 88], [moyenne, 320]] as const) {
      const centre = (m.top + (800 - m.bottom)) / 2;
      expect(centre).toBeLessThan(800 - h);
      expect(centre).toBeGreaterThan(140);
    }
  });
});

describe("carte d'arrêt compacte", () => {
  it("masque la ligne secondaire qui répète l'adresse", () => {
    expect(repeteAdresse("13 Imp. Paul Valéry", "13 Imp. Paul Valéry, 66200 Elne")).toBe(true);
    expect(repeteAdresse("13 imp paul valery", "13 Imp. Paul Valéry, 66200 Elne")).toBe(true);
    expect(repeteAdresse("Mme Martin", "13 Imp. Paul Valéry, 66200 Elne")).toBe(false);
    expect(repeteAdresse("", "13 Imp. Paul Valéry")).toBe(true);
    expect(repeteAdresse("13", "130 rue de la Paix")).toBe(false);
  });
  it("adresse courte : avant la première virgule", () => {
    expect(adresseCourte("13 Imp. Paul Valéry, 66200 Elne")).toBe("13 Imp. Paul Valéry");
    expect(adresseCourte("Mairie")).toBe("Mairie");
  });
});

describe("découpe parcouru / restant du tracé", () => {
  const ligne: [number, number][] = [
    [2.97, 42.6],
    [2.97, 42.601],
    [2.971, 42.601],
  ];
  it("coupe à la position projetée du véhicule", () => {
    const { parcouru, restant } = decouperTrace(ligne, { lat: 42.6005, lng: 2.97002 });
    expect(parcouru).toHaveLength(2);
    expect(parcouru[1]![1]).toBeCloseTo(42.6005, 5);
    expect(parcouru[1]![0]).toBeCloseTo(2.97, 6);
    expect(restant[0]).toEqual(parcouru[1]);
    expect(restant.slice(1)).toEqual(ligne.slice(1));
  });
  it("sur le second segment, le parcouru garde les sommets passés", () => {
    const { parcouru, restant } = decouperTrace(ligne, { lat: 42.601, lng: 2.9705 });
    expect(parcouru.slice(0, 2)).toEqual(ligne.slice(0, 2));
    expect(restant).toHaveLength(2);
  });
  it("sans position : tout reste à parcourir", () => {
    expect(decouperTrace(ligne, null)).toEqual({ parcouru: [], restant: ligne });
    expect(decouperTrace([[2.97, 42.6]], { lat: 42.6, lng: 2.97 })).toEqual({ parcouru: [], restant: [[2.97, 42.6]] });
  });
});
