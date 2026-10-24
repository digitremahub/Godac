import { describe, expect, it } from "vitest";
import { longueurParcours, optimiserOrdre, type Point } from "@/lib/colis/optimisation";

const depot: Point = { lat: 45.75, lng: 4.85 }; // Lyon

describe("optimiserOrdre", () => {
  it("renvoie chaque arrêt une fois", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ lat: 45.7 + ((i * 37) % 23) / 100, lng: 4.8 + ((i * 53) % 29) / 100 }));
    const ordre = optimiserOrdre(depot, pts);
    expect([...ordre].sort((a, b) => a - b)).toEqual(pts.map((_, i) => i));
  });

  it("des arrêts alignés sont parcourus dans l'ordre de la ligne", () => {
    const ligne = [5, 1, 4, 2, 3].map((k) => ({ lat: 45.75, lng: 4.85 + k * 0.01 }));
    const ordre = optimiserOrdre(depot, ligne, false);
    expect(ordre.map((i) => ligne[i]!.lng)).toEqual([...ligne.map((p) => p.lng)].sort((a, b) => a - b));
  });

  it("raccourcit nettement un ordre de chargement au hasard", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pts = Array.from({ length: 80 }, () => ({ lat: 45.6 + rnd() * 0.3, lng: 4.7 + rnd() * 0.4 }));
    const avant = longueurParcours(depot, pts, true);
    const ordre = optimiserOrdre(depot, pts);
    const apres = longueurParcours(depot, ordre.map((i) => pts[i]!), true);
    expect(apres).toBeLessThan(avant * 0.4);
  });

  it("cas limites", () => {
    expect(optimiserOrdre(depot, [])).toEqual([]);
    expect(optimiserOrdre(depot, [depot])).toEqual([0]);
    expect(optimiserOrdre(null, [depot, { lat: 46, lng: 5 }, { lat: 45.8, lng: 4.9 }]).length).toBe(3);
  });
});

describe("optimiserOrdre sans point de départ (compte d'essai sans dépôt)", () => {
  // Cinq arrêts alignés d'ouest en est ; le point de départ n'est pas connu.
  const ligne = [0, 1, 2, 3, 4].map((i) => ({ lat: 43, lng: 2 + i * 0.1 }));
  const longueur = (ordre: number[], pts: typeof ligne) => ordre.slice(1).reduce((t, idx, k) => t + Math.hypot(pts[idx]!.lat - pts[ordre[k]!]!.lat, pts[idx]!.lng - pts[ordre[k]!]!.lng), 0);

  it("ne fige plus le premier arrêt saisi : un ordre mélangé donne le chemin le plus court", () => {
    const melange = [ligne[2]!, ligne[0]!, ligne[4]!, ligne[1]!, ligne[3]!];
    const ordre = optimiserOrdre(null, melange, true);
    expect([...ordre].sort()).toEqual([0, 1, 2, 3, 4]);
    const optimum = 0.4;
    expect(longueur(ordre, melange)).toBeCloseTo(optimum, 6);
  });

  it("le résultat ne dépend pas de l'arrêt placé en premier", () => {
    const a = [ligne[1]!, ligne[0]!, ligne[2]!, ligne[3]!, ligne[4]!];
    const b = [ligne[3]!, ligne[4]!, ligne[0]!, ligne[2]!, ligne[1]!];
    expect(longueur(optimiserOrdre(null, a, true), a)).toBeCloseTo(0.4, 6);
    expect(longueur(optimiserOrdre(null, b, true), b)).toBeCloseTo(0.4, 6);
  });

  it("avec un départ connu, l'arrêt le plus proche passe en premier (inchangé)", () => {
    const ordre = optimiserOrdre({ lat: 43, lng: 1.9 }, ligne, false);
    expect(ordre[0]).toBe(0);
  });
});
