import { describe, expect, it } from "vitest";
import { ordonnerAvecHoraires, simulerPassages, type Fenetres } from "@/lib/colis/horaires";
import type { Point } from "@/lib/colis/optimisation";

const depot: Point = { lat: 45.75, lng: 4.85 };
const est = (km: number): Point => ({ lat: 45.75, lng: 4.85 + km / (111.32 * Math.cos((45.75 * Math.PI) / 180)) });

describe("priorité aux fermetures proches", () => {
  it("sert d'abord l'adresse qui ferme bientôt, même si l'autre ordre est un peu plus court", () => {
    // A ferme à 8:20 (2 km à l'ouest), B sans horaires (1 km à l'est), départ 8:00.
    // B puis A reste livrable (arrivée ≈ 8:12) mais ne laisse que 8 min de marge.
    const arrets = [
      { point: est(-2), fenetres: [[0, 500]] as Fenetres },
      { point: est(1), fenetres: null },
    ];
    const r = ordonnerAvecHoraires(depot, arrets, { debut: 480, retour: false });
    expect(r.ordre).toEqual([0, 1]);
    expect(r.impossibles).toEqual([]);
    const sim = simulerPassages({ point: depot, minute: 480 }, r.ordre.map((k) => arrets[k]!));
    expect(sim.passages[0]!.statut).toBe("ok");
    expect(500 - sim.passages[0]!.arrivee).toBeGreaterThan(10);
  });

  it("sans fermeture proche, l'ordre le plus court est gardé", () => {
    const arrets = [
      { point: est(-2), fenetres: [[0, 720]] as Fenetres },
      { point: est(1), fenetres: null },
    ];
    const r = ordonnerAvecHoraires(depot, arrets, { debut: 480, retour: false });
    expect(r.ordre).toEqual([1, 0]);
  });
});
