import { describe, expect, it } from "vitest";
import { correspondRequete, depuisPhoton, filtrerAnnuaire, fusionnerSuggestions, libelleSuggestion, lireBiais, type SuggestionAdresse } from "@/lib/colis/recherche-adresses";

const etab = (nom: string, adresse: string, source: SuggestionAdresse["source"] = "osm"): SuggestionAdresse => ({ type: "etablissement", nom, adresse, lat: 1, lng: 2, source });
const adr = (adresse: string): SuggestionAdresse => ({ type: "adresse", nom: null, adresse, lat: 1, lng: 2, source: "ban" });

describe("recherche d'adresses et d'établissements", () => {
  it("correspondance sans accents, tous les mots", () => {
    expect(correspondRequete("Pharmacie du Centre — 2 place de l'Église, Saint-Xandre", "pharmacie centre saint")).toBe(true);
    expect(correspondRequete("Pharmacie du Centre", "pharmacie gare")).toBe(false);
    expect(correspondRequete("Carrefour Market", "  ")).toBe(false);
  });

  it("annuaire interne : par nom ou par adresse", () => {
    const annuaire = [
      { nom: "Pharmacie du Centre", adresse: "2 place de l'Église 17138 Saint-Xandre" },
      { nom: null, adresse: "5 rue des Lilas 17000 La Rochelle" },
    ];
    expect(filtrerAnnuaire(annuaire, "pharmacie centre")).toMatchObject([{ type: "etablissement", nom: "Pharmacie du Centre", source: "annuaire" }]);
    expect(filtrerAnnuaire(annuaire, "lilas")).toMatchObject([{ type: "adresse", nom: null }]);
  });

  it("Photon : établissement nommé (commerce) ou adresse postale, coordonnées [lng, lat]", () => {
    expect(depuisPhoton({ name: "Carrefour Market", osm_key: "shop", osm_value: "supermarket", housenumber: "12", street: "Avenue de la Gare", postcode: "17000", city: "La Rochelle" }, [-1.15, 46.16])).toEqual({
      type: "etablissement",
      nom: "Carrefour Market",
      adresse: "12 Avenue de la Gare, 17000 La Rochelle",
      lat: 46.16,
      lng: -1.15,
      source: "osm",
      detail: "Supermarché",
    });
    expect(depuisPhoton({ name: "Rue des Lilas", osm_key: "highway", postcode: "17000", city: "La Rochelle" }, [-1.1, 46.1])).toMatchObject({ type: "adresse", nom: null, adresse: "Rue des Lilas, 17000 La Rochelle" });
    expect(depuisPhoton({ name: "Quelque part", osm_key: "place" }, null)).toBeNull();
  });

  it("fusion : annuaire d'abord, établissements et adresses alternés, sans doublon, limité", () => {
    const r = fusionnerSuggestions(
      [etab("Pharmacie du Centre", "2 place de l'Église, Saint-Xandre", "annuaire")],
      [[etab("Pharmacie du centre", "2 Place de l’Eglise, Saint-Xandre"), etab("Carrefour Market", "Av. de la Gare")], [adr("2 Place du Centre, 17138 Saint-Xandre")]],
      3,
    );
    // Le doublon OSM de l'entrée d'annuaire est écarté.
    expect(r.map(libelleSuggestion)).toEqual(["Pharmacie du Centre — 2 place de l'Église, Saint-Xandre", "2 Place du Centre, 17138 Saint-Xandre", "Carrefour Market — Av. de la Gare"]);
  });

  it("biais géographique valide uniquement", () => {
    expect(lireBiais("46.16", "-1.15")).toEqual({ lat: 46.16, lng: -1.15 });
    expect(lireBiais("abc", "1")).toBeNull();
    expect(lireBiais(null, "1")).toBeNull();
    expect(lireBiais("95", "1")).toBeNull();
  });
});
