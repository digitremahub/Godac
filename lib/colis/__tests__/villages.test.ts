import { describe, expect, it } from "vitest";
import { cleCommune, communeDepuisAdresse, villagePourAdresse } from "@/lib/colis/villages";

const villages = [
  { id: "g", name: "Gignac", postal_code: "34150", lat: 43.652, lng: 3.551 },
  { id: "a", name: "Aniane", postal_code: "34150", lat: 43.685, lng: 3.587 },
  { id: "s", name: "Saint-Jean-de-Fos", postal_code: "34150", lat: 43.701, lng: 3.553 },
];

describe("commune d'une adresse", () => {
  it("code postal + commune, avec ou sans virgule", () => {
    expect(communeDepuisAdresse("3 rue des Lilas, 34150 Gignac")).toEqual({ commune: "Gignac", codePostal: "34150" });
    expect(communeDepuisAdresse("3 rue des Lilas 34150 GIGNAC, France")).toEqual({ commune: "GIGNAC", codePostal: "34150" });
    expect(communeDepuisAdresse("Mairie, Aniane")).toEqual({ commune: "Aniane", codePostal: null });
    expect(communeDepuisAdresse("12 chemin des Vignes")).toEqual({ commune: null, codePostal: null });
  });

  it("noms comparables", () => {
    expect(cleCommune("St-Jean-de-Fos")).toBe(cleCommune("Saint Jean de Fos"));
    expect(cleCommune("SAINT-JEAN-DE-FÔS")).toBe("saint jean de fos");
  });
});

describe("villagePourAdresse", () => {
  it("par la commune", () => {
    expect(villagePourAdresse({ commune: "st jean de fos", codePostal: "34150" }, villages)).toMatchObject({ village: { id: "s" }, raison: "commune" });
  });

  it("par les coordonnées quand la commune est inconnue (hameau)", () => {
    const r = villagePourAdresse({ commune: null, point: { lat: 43.66, lng: 3.56 } }, villages);
    expect(r).toMatchObject({ village: { id: "g" }, raison: "proximite" });
  });

  it("commune connue hors tournée : seulement si très proche d'un village", () => {
    expect(villagePourAdresse({ commune: "Montpellier", point: { lat: 43.61, lng: 3.877 } }, villages)).toEqual({ village: null, raison: "hors_tournee" });
    // Lieu-dit pris pour la commune, à quelques centaines de mètres d'Aniane.
    expect(villagePourAdresse({ commune: "Le Moulin", point: { lat: 43.688, lng: 3.59 } }, villages).village?.id).toBe("a");
  });

  it("sans village ni coordonnées : hors tournée", () => {
    expect(villagePourAdresse({ commune: "Lodève" }, villages).village).toBeNull();
    expect(villagePourAdresse({ commune: "Gignac" }, []).village).toBeNull();
  });
});
