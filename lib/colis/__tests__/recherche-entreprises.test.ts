import { describe, expect, it } from "vitest";
import { casseTitre, departementDepuisReverse, lireAdresse, lireCoordonnees, lireEntreprises, preparerRequete, ressembleAUnNom, urlRecherche } from "@/lib/colis/recherche-entreprises";
import { completerSuggestions, fusionnerSuggestions, libelleSuggestion, ordonnerRapide, type SuggestionAdresse } from "@/lib/colis/recherche-adresses";

// Forme de la réponse de https://recherche-entreprises.api.gouv.fr/search (coordonnées en chaînes, MAJUSCULES).
const REPONSE = {
  results: [
    {
      siren: "123456789",
      nom_complet: "BOULANGERIE DUPONT (DUPONT)",
      nom_raison_sociale: "BOULANGERIE DUPONT",
      sigle: "DUPONT",
      nature_juridique: "5499",
      etat_administratif: "A",
      siege: { siret: "12345678900011", adresse: "12 AVENUE DE LA GARE 17000 LA ROCHELLE", geo_adresse: "12 Avenue de la Gare 17000 La Rochelle", code_postal: "17000", libelle_commune: "LA ROCHELLE", latitude: "46.1591", longitude: "-1.1520", activite_principale: "10.71C" },
      matching_etablissements: [
        { siret: "12345678900029", adresse: "5 RUE DES LILAS 17138 SAINT-XANDRE", code_postal: "17138", libelle_commune: "SAINT-XANDRE", latitude: "46.1897", longitude: "-1.1264", nom_commercial: null, liste_enseignes: ["AU FOURNIL DE JEAN"], etat_administratif: "A" },
      ],
    },
    {
      siren: "987654321",
      nom_complet: "PHARMACIE DU CENTRE",
      nom_raison_sociale: "PHARMACIE DU CENTRE",
      nature_juridique: "5499",
      siege: { adresse: "2 PLACE DE L EGLISE 17138 SAINT-XANDRE", code_postal: "17138", libelle_commune: "SAINT-XANDRE", latitude: null, longitude: null },
      matching_etablissements: [],
    },
  ],
  total_results: 2,
};

describe("Recherche d'entreprises : lecteur de réponse", () => {
  it("établissements correspondants d'abord (enseigne), sinon siège ; adresse complète, type pro, source sirene", () => {
    const r = lireEntreprises(REPONSE);
    expect(r).toEqual([
      { type: "pro", nom: "Au Fournil de Jean", adresse: "5 Rue des Lilas, 17138 Saint-Xandre", lat: 46.1897, lng: -1.1264, source: "sirene", detail: "Entreprise · Boulangerie Dupont" },
      { type: "pro", nom: "Pharmacie du Centre", adresse: "2 Place de l'Eglise, 17138 Saint-Xandre", lat: null, lng: null, source: "sirene", detail: "Entreprise" },
    ]);
  });

  it("geo_adresse (casse et accents) préférée à adresse", () => {
    expect(lireAdresse({ geo_adresse: "12 Avenue de la Gare 17000 La Rochelle", adresse: "12 AVENUE DE LA GARE 17000 LA ROCHELLE", code_postal: "17000", libelle_commune: "LA ROCHELLE" })).toBe("12 Avenue de la Gare, 17000 La Rochelle");
  });

  it("adresse reconstituée depuis les éléments de la voie", () => {
    expect(lireAdresse({ numero_voie: "7", type_voie: "RUE", libelle_voie: "DU PORT", code_postal: "17000", libelle_commune: "LA ROCHELLE" })).toBe("7 Rue du Port, 17000 La Rochelle");
  });

  it("ignore les résultats sans adresse ou non diffusibles, les entreprises fermées et les entrepreneurs individuels sans enseigne", () => {
    const r = lireEntreprises({
      results: [
        { nom_raison_sociale: "SANS ADRESSE", siege: { code_postal: "17000", libelle_commune: "LA ROCHELLE" } },
        { nom_raison_sociale: "MASQUEE", siege: { adresse: "[ND]", code_postal: "[ND]", libelle_commune: "[ND]" } },
        { nom_raison_sociale: "FERMEE", etat_administratif: "F", siege: { adresse: "1 RUE A 17000 LA ROCHELLE" } },
        { nom_complet: "DURAND MARIE", nature_juridique: "1000", siege: { adresse: "3 RUE B 17000 LA ROCHELLE" } },
        { nom_complet: "MARTIN PAUL", nature_juridique: "1000", siege: { adresse: "4 RUE C 17000 LA ROCHELLE", liste_enseignes: ["LE PETIT BAR"] } },
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ nom: "Le Petit Bar", adresse: "4 Rue C, 17000 La Rochelle", detail: "Entreprise" });
  });

  it("très tolérant : types inattendus, champs absents, JSON invalide ne lèvent jamais", () => {
    for (const x of [null, undefined, 42, "texte", [], {}, { results: null }, { results: "x" }, { results: [null, 3, "a", [], {}] }, { results: [{ siege: 5, matching_etablissements: "oups" }] }, { results: [{ nom_complet: 12, siege: { adresse: 99, latitude: {}, longitude: [] }, matching_etablissements: [null, 1] }] }]) {
      expect(() => lireEntreprises(x)).not.toThrow();
      expect(lireEntreprises(x)).toEqual([]);
    }
  });

  it("coordonnées : nombres ou chaînes, sinon null ; (0, 0) et hors bornes rejetés", () => {
    expect(lireCoordonnees("46.16", "-1.15")).toEqual({ lat: 46.16, lng: -1.15 });
    expect(lireCoordonnees(46.16, -1.15)).toEqual({ lat: 46.16, lng: -1.15 });
    expect(lireCoordonnees("46,16", "-1,15")).toEqual({ lat: 46.16, lng: -1.15 });
    for (const [a, b] of [[null, 1], ["x", "y"], [0, 0], [95, 1], ["", ""], [undefined, undefined]] as const) expect(lireCoordonnees(a, b)).toBeNull();
  });

  it("limite le nombre de résultats et d'établissements par entreprise", () => {
    const etab = (i: number) => ({ adresse: `${i} RUE X 17000 LA ROCHELLE`, nom_commercial: `Boutique ${i}` });
    const r = lireEntreprises({ results: [{ nom_raison_sociale: "GROUPE", matching_etablissements: [1, 2, 3, 4, 5].map(etab) }] }, 8, 3);
    expect(r.map((s) => s.nom)).toEqual(["Boutique 1", "Boutique 2", "Boutique 3"]);
  });

  it("casse titre", () => {
    expect(casseTitre("PLACE DE L'EGLISE")).toBe("Place de l'Eglise");
    expect(casseTitre("SAINT-XANDRE")).toBe("Saint-Xandre");
    expect(casseTitre("Déjà Mixte")).toBe("Déjà Mixte");
  });
});

describe("Recherche d'entreprises : requête", () => {
  it("ne cherche que si le texte ressemble à un nom", () => {
    expect(ressembleAUnNom("Boulangerie Dupont")).toBe(true);
    expect(ressembleAUnNom("bou")).toBe(true);
    expect(ressembleAUnNom("12")).toBe(false);
    expect(ressembleAUnNom("12 bis")).toBe(false);
    expect(ressembleAUnNom("17000")).toBe(false);
    expect(ressembleAUnNom("12 rue des Lilas")).toBe(false);
    expect(ressembleAUnNom("3bis avenue de la Gare")).toBe(false);
    expect(ressembleAUnNom("ab")).toBe(false);
  });

  it("code postal du texte = filtre ; texte débarrassé du code postal", () => {
    expect(preparerRequete("boulangerie dupont 17000")).toEqual({ texte: "boulangerie dupont", codePostal: "17000" });
    expect(preparerRequete("17000")).toBeNull();
    expect(preparerRequete("12 rue des lilas")).toBeNull();
    expect(preparerRequete("Pharmacie du Centre")).toEqual({ texte: "Pharmacie du Centre", codePostal: null });
  });

  it("URL : état actif, 8 résultats, filtre code postal sinon département", () => {
    const u = new URL(urlRecherche({ texte: "pharmacie du centre", codePostal: null }, "17"));
    expect(u.origin + u.pathname).toBe("https://recherche-entreprises.api.gouv.fr/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "pharmacie du centre", per_page: "8", etat_administratif: "A", departement: "17" });
    expect(new URL(urlRecherche({ texte: "x y", codePostal: "17000" }, "17")).searchParams.get("code_postal")).toBe("17000");
    expect(new URL(urlRecherche({ texte: "x y", codePostal: "17000" }, "17")).searchParams.has("departement")).toBe(false);
    expect(new URL(urlRecherche({ texte: "x y", codePostal: null }, "n'importe quoi")).searchParams.has("departement")).toBe(false);
  });

  it("département depuis le géocodage inverse BAN", () => {
    expect(departementDepuisReverse({ features: [{ properties: { context: "17, Charente-Maritime, Nouvelle-Aquitaine", postcode: "17000" } }] })).toBe("17");
    expect(departementDepuisReverse({ features: [{ properties: { context: "2A, Corse-du-Sud, Corse" } }] })).toBe("2A");
    expect(departementDepuisReverse({ features: [{ properties: { postcode: "97400" } }] })).toBe("974");
    expect(departementDepuisReverse({ features: [] })).toBeNull();
    expect(departementDepuisReverse(null)).toBeNull();
  });
});

const pro = (nom: string, adresse: string, source: SuggestionAdresse["source"] = "sirene"): SuggestionAdresse => ({ type: "pro", nom, adresse, lat: null, lng: null, source, detail: "Entreprise" });
const ban = (adresse: string): SuggestionAdresse => ({ type: "adresse", nom: null, adresse, lat: 1, lng: 2, source: "ban" });
const annu = (nom: string, adresse: string): SuggestionAdresse => ({ type: "etablissement", nom, adresse, lat: 1, lng: 2, source: "annuaire" });
const google = (nom: string, adresse: string): SuggestionAdresse => ({ type: "etablissement", nom, adresse, lat: null, lng: null, source: "google", placeId: "p" });

describe("fusion avec les professionnels SIRENE", () => {
  it("sans Google : annuaire, pros dont le nom correspond, adresses BAN, autres pros", () => {
    const r = ordonnerRapide(
      [annu("Pharmacie du Centre", "2 place de l'Église, 17138 Saint-Xandre")],
      [ban("2 Rue du Centre, 17138 Saint-Xandre"), ban("Rue de la Gare, 17000 La Rochelle")],
      8,
      [pro("Tabac Presse", "9 Rue Z, 17000 La Rochelle"), pro("Pharmacie du Centre Ville", "8 Rue Y, 17000 La Rochelle")],
      "pharmacie centre",
    );
    expect(r.map(libelleSuggestion)).toEqual([
      "Pharmacie du Centre — 2 place de l'Église, 17138 Saint-Xandre",
      "Pharmacie du Centre Ville — 8 Rue Y, 17000 La Rochelle",
      "2 Rue du Centre, 17138 Saint-Xandre",
      "Rue de la Gare, 17000 La Rochelle",
      "Tabac Presse — 9 Rue Z, 17000 La Rochelle",
    ]);
  });

  it("avec Google : Google reste prioritaire, SIRENE à la suite (places réservées)", () => {
    const principal = [1, 2, 3, 4, 5].map((i) => google(`Lieu ${i}`, `${i} rue G, 17000 La Rochelle`));
    const r = ordonnerRapide([annu("A1", "1 rue a"), annu("A2", "2 rue a"), annu("A3", "3 rue a"), annu("A4", "4 rue a")], principal, 8, [pro("Lieu Pro", "8 rue P, 17000 La Rochelle")], "lieu");
    expect(r.map((s) => s.source)).toEqual(["annuaire", "annuaire", "annuaire", "annuaire", "google", "google", "google", "sirene"]);
    expect(r.some((s) => s.source === "sirene")).toBe(true);
    expect(r.findIndex((s) => s.source === "sirene")).toBeGreaterThan(r.findIndex((s) => s.source === "google"));
  });

  it("dédoublonnage : même nom+adresse normalisés, ou même nom + CP + numéro de rue", () => {
    const r = ordonnerRapide([annu("Pharmacie du Centre", "2 Place de l'Eglise, 17138 Saint-Xandre")], [], 8, [pro("PHARMACIE DU CENTRE", "2 place de l’église, 17138 saint-xandre"), pro("Pharmacie du Centre", "2 Pl. de l'Église, 17138 Saint-Xandre"), pro("Pharmacie du Centre", "20 rue X, 17138 Saint-Xandre")], "pharmacie centre");
    expect(r).toHaveLength(2);
    expect(r[1]!.adresse).toBe("20 rue X, 17138 Saint-Xandre");
  });

  it("sans pros, comportement inchangé ; type pro traité comme un lieu nommé dans fusion et complément", () => {
    expect(ordonnerRapide([], [ban("a b 17000 X")])).toEqual([ban("a b 17000 X")]);
    const f = fusionnerSuggestions([], [[ban("1 rue A, 17000 X"), ban("2 rue B, 17000 X")], [pro("Pro", "3 rue C, 17000 X")]], 3);
    expect(f.map((s) => s.type)).toEqual(["pro", "adresse", "adresse"]);
    const c = completerSuggestions([ban("1 rue A, 17000 X")], [ban("2 rue B, 17000 X"), pro("Pro", "3 rue C, 17000 X"), { ...pro("Pro", "3 Rue C, 17000 X"), source: "osm", type: "etablissement" }]);
    expect(c.map((s) => s.adresse)).toEqual(["1 rue A, 17000 X", "3 rue C, 17000 X", "2 rue B, 17000 X"]);
  });
});
