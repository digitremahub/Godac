import { describe, expect, it } from "vitest";
import { evaluerPlein, litresEstimes, meilleureStation } from "@/lib/colis/gasoil";

describe("passage au gasoil", () => {
  const depuis = { lat: 42.7, lng: 2.9 };
  const vers = { lat: 42.7, lng: 3.1 };
  it("choisit la station la moins détournée et ignore celles sans diesel", () => {
    const s = meilleureStation(depuis, vers, [
      { lat: 42.7, lon: 3.0, tags: { name: "Sur la route" } },
      { lat: 42.9, lon: 2.9, tags: { name: "Loin" } },
      { lat: 42.7, lon: 3.0, tags: { name: "Sans diesel", "fuel:diesel": "no" } },
    ]);
    expect(s?.nom).toBe("Sur la route");
    expect(s?.detourKm).toBeLessThan(1);
    expect(meilleureStation(depuis, vers, [])).toBeNull();
  });
  it("consommation estimée du retour", () => {
    expect(litresEstimes(50, 10)).toBe(5);
    expect(litresEstimes(50, null)).toBeNull();
  });
});

describe("plein nécessaire", () => {
  it("réservoir presque vide : plein nécessaire", () => {
    const r = evaluerPlein({ capaciteL: 80, kmDepuisPlein: 700, lPer100: 10, retourKm: 20 });
    expect(r).toMatchObject({ restantL: 10, necessaire: true });
  });
  it("réservoir bien rempli : pas nécessaire", () => {
    const r = evaluerPlein({ capaciteL: 80, kmDepuisPlein: 100, lPer100: 10, retourKm: 20 });
    expect(r).toMatchObject({ restantL: 70, autonomieKm: 700, necessaire: false });
  });
  it("donnée manquante : pas d'estimation", () => {
    expect(evaluerPlein({ capaciteL: null, kmDepuisPlein: 100, lPer100: 10, retourKm: 20 })).toBeNull();
    expect(evaluerPlein({ capaciteL: 80, kmDepuisPlein: null, lPer100: 10, retourKm: 20 })).toBeNull();
  });
});
