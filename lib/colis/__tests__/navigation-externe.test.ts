import { describe, expect, it } from "vitest";
import { gmaps, waze, type Stop } from "@/components/colis/commun";

const arret = (p: Partial<Stop>) => ({ address: "12 rue de la Paix, 75002 Paris", lat: null, lng: null, ...p }) as Stop;

describe("ouverture de l'itinéraire dans Google Maps ou Waze (bouton de GO Navigation et de l’app chauffeur)", () => {
  it("coordonnées connues : destination exacte", () => {
    expect(gmaps(arret({ lat: 48.8687, lng: 2.3317 }))).toBe("https://www.google.com/maps/dir/?api=1&destination=48.8687%2C2.3317&travelmode=driving");
    expect(waze(arret({ lat: 48.8687, lng: 2.3317 }))).toBe("https://waze.com/ul?ll=48.8687,2.3317&navigate=yes");
  });
  it("adresse non localisée : recherche par adresse", () => {
    expect(gmaps(arret({}))).toContain("destination=12%20rue%20de%20la%20Paix");
    expect(waze(arret({}))).toBe("https://waze.com/ul?q=12%20rue%20de%20la%20Paix%2C%2075002%20Paris&navigate=yes");
  });
});
