import { describe, expect, it } from "vitest";
import { CacheSuggestions, cleBiais } from "@/lib/colis/cache-adresses";
import { cleGoogle, corpsAutocomplete, lireAutocomplete, lireDetail, placeIdValide, sessionValide } from "@/lib/colis/places-google";
import { completerSuggestions, ordonnerRapide, type SuggestionAdresse } from "@/lib/colis/recherche-adresses";

const etab = (nom: string, adresse: string, source: SuggestionAdresse["source"] = "osm"): SuggestionAdresse => ({ type: "etablissement", nom, adresse, lat: null, lng: null, source });
const adr = (adresse: string, source: SuggestionAdresse["source"] = "ban"): SuggestionAdresse => ({ type: "adresse", nom: null, adresse, lat: null, lng: null, source });

describe("Google Places (New)", () => {
  it("clé : GOOGLE_PLACES_API_KEY prioritaire, sinon GOOGLE_MAPS_API_KEY, sinon null", () => {
    expect(cleGoogle({ GOOGLE_PLACES_API_KEY: "a", GOOGLE_MAPS_API_KEY: "b" })).toBe("a");
    expect(cleGoogle({ GOOGLE_MAPS_API_KEY: "b" })).toBe("b");
    expect(cleGoogle({ GOOGLE_PLACES_API_KEY: "  " })).toBeNull();
  });

  it("corps de requête : session, pays, biais circulaire", () => {
    expect(corpsAutocomplete("pharm", "FR", { lat: 46.1, lng: -1.1 }, "tok")).toEqual({
      input: "pharm",
      languageCode: "fr",
      includedRegionCodes: ["fr"],
      sessionToken: "tok",
      locationBias: { circle: { center: { latitude: 46.1, longitude: -1.1 }, radius: 30000 } },
    });
    const sans = corpsAutocomplete("x", "BE", null, null);
    expect(sans).not.toHaveProperty("locationBias");
    expect(sans).not.toHaveProperty("sessionToken");
  });

  it("lecture Autocomplete : établissement vs adresse, placeId, entrées incomplètes ignorées", () => {
    const r = lireAutocomplete({
      suggestions: [
        { placePrediction: { placeId: "ChIJabcdefghij", types: ["pharmacy", "establishment"], structuredFormat: { mainText: { text: "Pharmacie du Centre" }, secondaryText: { text: "2 Pl. de l'Église, Saint-Xandre, France" } } } },
        { placePrediction: { placeId: "ChIJklmnopqrst", types: ["street_address"], structuredFormat: { mainText: { text: "12 Rue des Lilas" }, secondaryText: { text: "La Rochelle, France" } } } },
        { placePrediction: { structuredFormat: {} } },
        { queryPrediction: {} },
      ],
    });
    expect(r).toEqual([
      { type: "etablissement", nom: "Pharmacie du Centre", adresse: "2 Pl. de l'Église, Saint-Xandre, France", lat: null, lng: null, source: "google", placeId: "ChIJabcdefghij" },
      { type: "adresse", nom: null, adresse: "12 Rue des Lilas, La Rochelle, France", lat: null, lng: null, source: "google", placeId: "ChIJklmnopqrst" },
    ]);
    expect(lireAutocomplete(null)).toEqual([]);
    expect(lireAutocomplete({})).toEqual([]);
  });

  it("lecture Place Details : coordonnées obligatoires", () => {
    expect(lireDetail({ location: { latitude: 46.2, longitude: -1.2 }, formattedAddress: "A", displayName: { text: "N" } })).toEqual({ lat: 46.2, lng: -1.2, adresse: "A", nom: "N" });
    expect(lireDetail({ formattedAddress: "A" })).toBeNull();
    expect(lireDetail(null)).toBeNull();
  });

  it("validation des paramètres", () => {
    expect(placeIdValide("ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe(true);
    expect(placeIdValide("../etc")).toBe(false);
    expect(sessionValide("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(sessionValide("court")).toBe(false);
  });
});

describe("ordre et fusion progressive", () => {
  it("réponse rapide : annuaire d'abord, puis la source principale dans son ordre, sans doublon", () => {
    const ann = [etab("Pharmacie du Centre", "2 place de l'Église", "annuaire")];
    const google = [adr("12 rue A", "google"), etab("Pharmacie du centre", "2 place de l’Eglise", "google"), adr("14 rue B", "google")];
    expect(ordonnerRapide(ann, google).map((s) => s.adresse)).toEqual(["2 place de l'Église", "12 rue A", "14 rue B"]);
    expect(ordonnerRapide([], Array.from({ length: 12 }, (_, i) => adr(`${i} rue`)), 8)).toHaveLength(8);
  });

  it("enrichissement : l'existant ne bouge pas, le complément s'ajoute à la suite (alterné), plafonné", () => {
    const deja = [adr("1 rue X"), adr("2 rue X")];
    const r = completerSuggestions(deja, [adr("1 rue x"), etab("Boulangerie", "3 rue Y"), adr("4 rue Z")]);
    expect(r.map((s) => s.adresse)).toEqual(["1 rue X", "2 rue X", "3 rue Y", "4 rue Z"]);
    expect(completerSuggestions(deja, [])).toEqual(deja);
  });
});

describe("cache des préfixes", () => {
  const k = cleBiais({ lat: 46.1549, lng: -1.1522 });

  it("clé de biais arrondie ; lecture insensible à la casse et aux espaces", () => {
    expect(k).toBe(cleBiais({ lat: 46.15, lng: -1.15 }));
    const c = new CacheSuggestions();
    c.ecrire("Rue  des Lilas", k, [adr("rue des lilas")]);
    expect(c.lire(" rue des lilas ", k)).toHaveLength(1);
    expect(c.lire("rue des lilas", "-")).toBeUndefined();
  });

  it("préfixe : affiche tout de suite les résultats du préfixe filtrés par la requête complète", () => {
    const c = new CacheSuggestions();
    c.ecrire("pharm", k, [etab("Pharmacie du Centre", "2 place de l'Église"), etab("Pharmacie de la Gare", "1 avenue de la Gare")]);
    expect(c.depuisPrefixe("pharmacie gare", k).map((s) => s.nom)).toEqual(["Pharmacie de la Gare"]);
    expect(c.depuisPrefixe("boulan", k)).toEqual([]);
  });

  it("capacité : éviction du moins récemment utilisé", () => {
    const c = new CacheSuggestions(2);
    c.ecrire("aaa", k, []);
    c.ecrire("bbb", k, []);
    c.lire("aaa", k);
    c.ecrire("ccc", k, []);
    expect(c.lire("bbb", k)).toBeUndefined();
    expect(c.lire("aaa", k)).toBeDefined();
  });
});
