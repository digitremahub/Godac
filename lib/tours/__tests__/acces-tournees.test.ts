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
    for (const r of ["manager", "manager_chauffeur", "direction"] as const) {
      expect(peutGererTournees(r)).toBe(true);
      expect(peutVoirCarteTournees(r)).toBe(true);
    }
    for (const r of ["chauffeur", "comptable"] as const) {
      expect(peutGererTournees(r)).toBe(false);
      expect(peutVoirCarteTournees(r)).toBe(false);
    }
  });
  it("la gestion voit toutes les tournées", () => {
    expect(tourneesVisibles(routes, { role: "direction", myServiceIds: [], plannedTourNumbers: [] })).toHaveLength(4);
  });
  it("un chauffeur voit son service, les tournées tous services et celle où il est planifié", () => {
    const vis = tourneesVisibles(routes, { role: "chauffeur", myServiceIds: ["s1"], plannedTourNumbers: ["T4"] });
    expect(vis.map((r) => r.tourNumber)).toEqual(["T1", "T3", "T4"]);
  });
  it("un autre rôle ne voit pas les autres services", () => {
    const vis = tourneesVisibles(routes, { role: "comptable", myServiceIds: [], plannedTourNumbers: [] });
    expect(vis.map((r) => r.tourNumber)).toEqual(["T3"]);
  });
});
