import { describe, expect, it } from "vitest";
import { dansDuree, etaArret, heureArrivee } from "@/lib/colis/eta";

// 22 octobre 2026, 14 h 25 à Paris (heure d'été, UTC+2).
const MAINTENANT = Date.UTC(2026, 9, 22, 12, 25);

describe("heure d'arrivée au prochain arrêt (GO Navigation)", () => {
  it("heure de Paris au format « 14 h 32 »", () => {
    expect(heureArrivee(MAINTENANT)).toBe("14 h 25");
    expect(heureArrivee(Date.UTC(2026, 0, 5, 7, 4))).toBe("08 h 04");
    expect(heureArrivee(Date.UTC(2026, 9, 22, 22, 10))).toBe("00 h 10");
  });
  it("durée « dans … »", () => {
    expect(dansDuree(7)).toBe("dans 7 min");
    expect(dansDuree(0.4)).toBe("dans < 1 min");
    expect(dansDuree(65)).toBe("dans 1 h 05");
  });
  it("durée OSRM : heure, durée et distance", () => {
    expect(etaArret({ maintenant: MAINTENANT, distanceM: 2400, dureeMin: 7 })).toEqual({ heure: "14 h 32", dans: "dans 7 min", distance: "2,4 km", estimee: false });
  });
  it("tracé approximatif : marqué estimé", () => {
    expect(etaArret({ maintenant: MAINTENANT, distanceM: 2400, dureeMin: 7, approx: true })?.estimee).toBe(true);
  });
  it("sans durée OSRM : estimée à 30 km/h", () => {
    expect(etaArret({ maintenant: MAINTENANT, distanceM: 5000, dureeMin: null })).toEqual({ heure: "14 h 35", dans: "dans 10 min", distance: "5 km", estimee: true });
  });
  it("distance inconnue : rien", () => {
    expect(etaArret({ maintenant: MAINTENANT, distanceM: null, dureeMin: 7 })).toBeNull();
  });
});
