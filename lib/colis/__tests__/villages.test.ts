import { describe, expect, it } from "vitest";
import {
  basculerTout,
  cleCommune,
  cochesParDefaut,
  communeDepuisAdresse,
  elementDeArret,
  elementsLancement,
  estListeHorsTournee,
  estListeReportee,
  nomCommuneLisible,
  partageReports,
  rangerAdresse,
  selectionLancement,
  separerReportes,
  villagePourAdresse,
} from "@/lib/colis/villages";

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

describe("rangement par commune hors tournée", () => {
  it("un village de la tournée reste rangé dans son village", () => {
    expect(rangerAdresse({ texte: "3 rue X, 34150 Gignac" }, villages)).toMatchObject({ type: "village", village: { id: "g" }, raison: "commune" });
  });

  it("une commune hors tournée a sa propre liste (nom lu sur l'adresse, mis en forme)", () => {
    expect(rangerAdresse({ texte: "5 avenue Foch, 34700 LODEVE" }, villages)).toEqual({ type: "commune", nom: "Lodeve", cle: "lodeve" });
    expect(rangerAdresse({ texte: "1 rue Y", commune: "ST-ANDRE-DE-SANGONIS", point: { lat: 43.66, lng: 3.71 } }, villages)).toMatchObject({ type: "commune", cle: "saint andre de sangonis" });
  });

  it("une même commune écrite de deux façons donne la même clé (un seul regroupement)", () => {
    const a = rangerAdresse({ texte: "2 rue A, 34700 Lodève" }, villages);
    const b = rangerAdresse({ texte: "9 rue B, LODEVE" }, villages);
    expect(a.type === "commune" && b.type === "commune" && a.cle === b.cle).toBe(true);
  });

  it("sans commune lisible : liste « Hors tournée » comme avant", () => {
    expect(rangerAdresse({ texte: "12 chemin des Vignes" }, villages)).toEqual({ type: "hors_tournee" });
  });

  it("sans village connu de la tournée, toute commune est hors tournée", () => {
    expect(rangerAdresse({ texte: "3 rue X, 34150 Gignac" }, [])).toMatchObject({ type: "commune", cle: "gignac" });
  });

  it("noms de commune lisibles", () => {
    expect(nomCommuneLisible("SAINT-JEAN-DE-FOS")).toBe("Saint-Jean-de-Fos");
    expect(nomCommuneLisible("st jean de fos")).toBe("St Jean de Fos");
  });

  it("reconnaît les listes hors tournée (drapeau ou nom) et « Reportés »", () => {
    expect(estListeHorsTournee({ name: "Lodève", is_hors_tournee: true })).toBe(true);
    expect(estListeHorsTournee({ name: "Hors tournée" })).toBe(true);
    expect(estListeHorsTournee({ name: "Gignac", is_hors_tournee: false })).toBe(false);
    expect(estListeReportee({ name: "Reportés" })).toBe(true);
    expect(estListeReportee({ name: "Reportes" })).toBe(true);
    expect(estListeReportee({ name: "Gignac" })).toBe(false);
  });
});

describe("cases du lancement", () => {
  const listes = [
    { id: "lg", name: "Gignac", hors_tournee: false, reportee: false, village_id: "g" },
    { id: "la", name: "Aniane", hors_tournee: false, reportee: false, village_id: "a" },
    { id: "ll", name: "Lodève", hors_tournee: true, reportee: false, village_id: null },
    { id: "lv", name: "Vide", hors_tournee: true, reportee: false, village_id: null },
    { id: "lr", name: "Reportés", hors_tournee: false, reportee: true, village_id: null },
  ];
  const arrets = [
    { list_id: "lg", parcel_count: 2, address: "1 rue A, 34150 Gignac" },
    { list_id: "lg", parcel_count: 1, address: "2 rue A, 34150 Gignac" },
    { list_id: "ll", parcel_count: 3, address: "5 rue B, 34700 Lodève" },
    // déjà reportés : un village de la tournée (Aniane) et une commune hors tournée
    { list_id: "lr", parcel_count: 1, address: "7 rue C, 34150 Aniane" },
    { list_id: "lr", parcel_count: 4, address: "8 rue D, 34800 Clermont-l'Hérault" },
  ];
  const noms = [{ id: "g", nom: "Gignac" }, { id: "a", nom: "Aniane" }, { id: "s", nom: "Saint-Jean-de-Fos" }];
  const elements = elementsLancement({ villages: noms, listes, arrets });

  it("villages de la tournée, communes hors tournée de la fiche et adresses déjà reportées, avec leurs comptes", () => {
    expect(elements.map((e) => [e.id, e.arrets, e.colis, e.horsTournee, e.reporte])).toEqual([
      ["g", 2, 3, false, false],
      ["a", 1, 1, false, true],
      ["s", 0, 0, false, false],
      ["liste:ll", 1, 3, true, false],
      ["commune:clermont l herault", 1, 4, true, true],
    ]);
    expect(elements.find((e) => e.id === "liste:lv")).toBeUndefined();
  });

  it("tout est coché par défaut, sauf ce qui avait été reporté ; tout cocher / décocher bascule", () => {
    const coches = cochesParDefaut(elements);
    expect(coches).toEqual(["g", "s", "liste:ll"]);
    expect(basculerTout(elements, coches)).toEqual(elements.map((e) => e.id));
    expect(basculerTout(elements, elements.map((e) => e.id))).toEqual([]);
  });

  it("démarrer demande au moins une case cochée", () => {
    expect(selectionLancement(elements, [])).toEqual({ ok: false, erreur: "Cochez au moins un village pour démarrer la tournée." });
    expect(selectionLancement([], [])).toMatchObject({ ok: true });
    const r = selectionLancement(elements, ["g", "inconnu"]);
    expect(r.ok && r.gardes.map((e) => e.id)).toEqual(["g"]);
    expect(r.ok && r.reportes.map((e) => e.id)).toEqual(["a", "s", "liste:ll", "commune:clermont l herault"]);
  });

  it("élément d'un arrêt : village, autre liste, ou reporté (par village puis commune)", () => {
    const l = listes.map((x) => ({ id: x.id, name: x.name, village_id: x.village_id }));
    expect(elementDeArret(arrets[0]!, l, noms)).toEqual({ id: "g", reporte: false });
    expect(elementDeArret(arrets[2]!, l, noms)).toEqual({ id: "liste:ll", reporte: false });
    expect(elementDeArret(arrets[3]!, l, noms)).toEqual({ id: "a", reporte: true });
    expect(elementDeArret(arrets[4]!, l, noms)).toEqual({ id: "commune:clermont l herault", reporte: true });
    expect(elementDeArret({ list_id: null, address: "x" }, l, noms)).toEqual({ id: "liste:__principale__", reporte: false });
  });

  it("exclusion non destructive : on reporte les décochés, on reprend les reportés cochés, rien n'est supprimé", () => {
    const l = listes.map((x) => ({ id: x.id, name: x.name, village_id: x.village_id }));
    const stops = arrets.map((a, i) => ({ ...a, id: `s${i}` }));
    const r = partageReports(stops, (a) => elementDeArret(a, l, noms), new Set(["g", "a"]));
    expect(r.aReporter.map((a) => a.id)).toEqual(["s2"]); // Lodève décochée
    expect(r.aReprendre.map((a) => a.id)).toEqual(["s3"]); // Aniane reportée puis cochée
    // Les adresses déjà reportées et toujours décochées ne bougent pas.
    expect(r.aReporter.concat(r.aReprendre).some((a) => a.id === "s4")).toBe(false);
  });

  it("les reportés sont séparés de la tournée en cours (liste « Reportés » masquée)", () => {
    const stops = arrets.map((a, i) => ({ ...a, id: `s${i}` }));
    const r = separerReportes(stops, listes.map((x) => ({ id: x.id, name: x.name })));
    expect(r.actifs).toHaveLength(3);
    expect(r.reportes.map((a) => a.id)).toEqual(["s3", "s4"]);
    expect(r.listes.map((x) => x.id)).not.toContain("lr");
  });
});
