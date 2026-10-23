import { describe, expect, it } from "vitest";
import { enDepassement, kmhDepuisMs, limiteLaPlusProche, lireMaxspeed } from "@/lib/colis/limitation-vitesse";

describe("vitesse réelle", () => {
  it("m/s → km/h, bruit à l'arrêt ramené à 0, inconnue → null", () => {
    expect(kmhDepuisMs(13.9)).toBe(50);
    expect(kmhDepuisMs(0.3)).toBe(0);
    expect(kmhDepuisMs(null)).toBeNull();
    expect(kmhDepuisMs(-1)).toBeNull();
  });
});

describe("balise maxspeed", () => {
  it("valeurs usuelles", () => {
    expect(lireMaxspeed("50")).toBe(50);
    expect(lireMaxspeed("FR:urban")).toBe(50);
    expect(lireMaxspeed("FR:motorway")).toBe(130);
    expect(lireMaxspeed("30 mph")).toBe(48);
    expect(lireMaxspeed("80;50")).toBe(50);
    expect(lireMaxspeed("none")).toBeNull();
    expect(lireMaxspeed(undefined)).toBeNull();
  });
  it("dépassement avec tolérance de 3 km/h", () => {
    expect(enDepassement(53, 50)).toBe(false);
    expect(enDepassement(54, 50)).toBe(true);
    expect(enDepassement(90, null)).toBe(false);
  });
});

describe("voie la plus proche", () => {
  const p = { lat: 42.7, lng: 2.9 };
  const voie = (lat: number, max: string) => ({ tags: { maxspeed: max, name: `Rue ${max}` }, geometry: [{ lat, lon: 2.899 }, { lat, lon: 2.901 }] });
  it("retient la voie la plus proche, ignore celles hors rayon", () => {
    const r = limiteLaPlusProche(p, [voie(42.70005, "30"), voie(42.7001, "80"), voie(42.71, "110")]);
    expect(r).toEqual({ limite: 30, route: "Rue 30" });
    expect(limiteLaPlusProche(p, [voie(42.71, "110")])).toBeNull();
  });
});
