import { describe, expect, it } from "vitest";
import type { SuggestionAdresse } from "@/lib/colis/recherche-adresses";
import { arretDepuisSuggestion, arretManuelValide, classerParProximite, decouperAdresse } from "../ajout-arret";

const s = (nom: string | null, lat: number | null, lng: number | null, extra: Partial<SuggestionAdresse> = {}): SuggestionAdresse => ({
  type: nom ? "etablissement" : "adresse", nom, adresse: `${nom ?? "Rue"} 66300 Thuir`, lat, lng, source: "osm", ...extra,
});
const village = { lat: 42.63, lng: 2.75 }; // Thuir

describe("classerParProximite", () => {
  it("le plus proche du village d'abord", () => {
    const r = classerParProximite([s("Loin", 42.9, 3.1), s("Près", 42.631, 2.751), s("Moyen", 42.7, 2.9)], village);
    expect(r.map((x) => x.nom)).toEqual(["Près", "Moyen", "Loin"]);
  });
  it("établissements avant adresses seules", () => {
    const r = classerParProximite([s(null, 42.63, 2.75), s("Boulangerie", 42.7, 2.9)], village);
    expect(r[0]!.nom).toBe("Boulangerie");
  });
  it("une suggestion sans coordonnées garde sa place", () => {
    const r = classerParProximite([s("Google", null, null), s("Loin", 42.9, 3.1), s("Près", 42.631, 2.751)], village);
    expect(r.map((x) => x.nom)).toEqual(["Google", "Près", "Loin"]);
  });
  it("sans biais, l'ordre reçu est conservé", () => {
    const r = classerParProximite([s("B", 42.9, 3.1), s("A", 42.631, 2.751)], null);
    expect(r.map((x) => x.nom)).toEqual(["B", "A"]);
  });
});

describe("arretDepuisSuggestion", () => {
  it("remplit nom, adresse, code postal, commune et coordonnées", () => {
    const a = arretDepuisSuggestion({ ...s("Boulangerie Martin", 42.63, 2.75), adresse: "3 rue du Pont, 66300 Thuir" }, "ramasse");
    expect(a).toEqual({ type: "ramasse", name: "Boulangerie Martin", address: "3 rue du Pont, 66300 Thuir", postal_code: "66300", city: "Thuir", lat: 42.63, lng: 2.75 });
  });
  it("adresse seule, sans coordonnées", () => {
    const a = arretDepuisSuggestion(s(null, null, null, { adresse: "Rue X" }), "point_relais");
    expect(a).toEqual({ type: "point_relais", address: "Rue X" });
  });
});

describe("decouperAdresse, arretManuelValide", () => {
  it("code postal et commune", () => {
    expect(decouperAdresse("12 rue X, 66300 Thuir")).toEqual({ codePostal: "66300", commune: "Thuir" });
    expect(decouperAdresse("12 rue X")).toEqual({ codePostal: null, commune: null });
  });
  it("nom ET adresse obligatoires", () => {
    expect(arretManuelValide("Pharmacie", "1 rue A")).toBe(true);
    expect(arretManuelValide("", "1 rue A")).toBe(false);
    expect(arretManuelValide("Pharmacie", "  ")).toBe(false);
  });
});
