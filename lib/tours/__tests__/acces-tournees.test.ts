import { describe, expect, it } from "vitest";
import { peutGererTournees, peutVoirCarteTournees, tourneesVisibles } from "@/lib/tours/acces-tournees";

const routes = [
  { tourNumber: "T1", serviceId: "s1" },
  { tourNumber: "T2", serviceId: "s2" },
  { tourNumber: "T3", serviceId: null },
  { tourNumber: "T4", serviceId: "s3" },
];

describe("accès à « Tournées & villages »", () => {
  it("carte et modification réservées aux chefs d'équipe et à la direction", () => {
    for (const r of ["manager", "direction"] as const) {
      expect(peutGererTournees(r)).toBe(true);
      expect(peutVoirCarteTournees(r)).toBe(true);
    }
    for (const r of ["chauffeur", "comptable"] as const) {
      expect(peutGererTournees(r)).toBe(false);
      expect(peutVoirCarteTournees(r)).toBe(false);
    }
  });
  it("la gestion voit toutes les tournées", () => {
    expect(tourneesVisibles(routes, { role: "direction", plannedTourNumbers: [] })).toHaveLength(4);
  });
  it("un chauffeur ne voit que les tournées où il est planifié, pas celles de ses collègues", () => {
    const vis = tourneesVisibles(routes, { role: "chauffeur", plannedTourNumbers: ["T4"] });
    expect(vis.map((r) => r.tourNumber)).toEqual(["T4"]);
  });
  it("sans planification, un chauffeur ne voit aucune tournée", () => {
    expect(tourneesVisibles(routes, { role: "chauffeur", plannedTourNumbers: [] })).toEqual([]);
    expect(tourneesVisibles(routes, { role: "comptable", plannedTourNumbers: [] })).toEqual([]);
  });
});
