import { describe, expect, it } from "vitest";
import {
  analyserSaisie,
  avecSuggestion,
  codePostalValide,
  completerCodePostal,
  indexDoublon,
  memeVillage,
  resumeArrets,
  saisieRecherchable,
  suggestionsDepuisCommunes,
  type CommuneApi,
} from "../ajout-village";

const commune = (nom: string, cps: string[], dep = "66", code = "66000"): CommuneApi => ({
  nom,
  code,
  codesPostaux: cps,
  centre: { type: "Point", coordinates: [2.9, 42.7] },
  departement: { code: dep, nom: dep === "66" ? "Pyrénées-Orientales" : "Isère" },
});

describe("analyserSaisie", () => {
  it("sépare le nom et le code postal", () => {
    expect(analyserSaisie("Ponteilla 66300")).toEqual({ nom: "Ponteilla", codePostal: "66300" });
    expect(analyserSaisie("66300 Ponteilla")).toEqual({ nom: "Ponteilla", codePostal: "66300" });
    expect(analyserSaisie("  Saint-Étienne, 42000 ")).toEqual({ nom: "Saint-Étienne", codePostal: "42000" });
  });
  it("code postal seul, nom seul, chiffres partiels", () => {
    expect(analyserSaisie("66300")).toEqual({ nom: "", codePostal: "66300" });
    expect(analyserSaisie("Toulouges")).toEqual({ nom: "Toulouges", codePostal: null });
    expect(analyserSaisie("663")).toEqual({ nom: "", codePostal: null });
    expect(saisieRecherchable(analyserSaisie("663"))).toBe(false);
    expect(saisieRecherchable(analyserSaisie("a"))).toBe(false);
    expect(saisieRecherchable(analyserSaisie("Po"))).toBe(true);
    expect(saisieRecherchable(analyserSaisie("66300"))).toBe(true);
  });
  it("un nombre de plus de 5 chiffres n'est pas un code postal", () => {
    expect(analyserSaisie("1234567").codePostal).toBeNull();
  });
});

describe("suggestionsDepuisCommunes", () => {
  it("une suggestion par code postal, avec département et coordonnées", () => {
    const r = suggestionsDepuisCommunes([commune("Perpignan", ["66000", "66100"])], analyserSaisie("Perpignan"));
    expect(r.map((s) => s.postal_code)).toEqual(["66000", "66100"]);
    expect(r[0]).toMatchObject({ name: "Perpignan", departement: "Pyrénées-Orientales", lat: 42.7, lng: 2.9, insee_code: "66000" });
  });
  it("nom exact avant préfixe avant le reste, ordre de l'API à rang égal", () => {
    const r = suggestionsDepuisCommunes(
      [commune("Saint-Estève", ["66240"]), commune("Estève", ["38000"], "38"), commune("Les Estèves", ["11000"], "11"), commune("Estève-Haut", ["09000"], "09")],
      analyserSaisie("Estève"),
    );
    expect(r.map((s) => s.name)).toEqual(["Estève", "Estève-Haut", "Saint-Estève", "Les Estèves"]);
  });
  it("garde 6 résultats au plus", () => {
    const communes = Array.from({ length: 10 }, (_, i) => commune(`Pont ${i}`, [`6600${i}`]));
    expect(suggestionsDepuisCommunes(communes, analyserSaisie("Pont"))).toHaveLength(6);
  });
  it("nom + code postal : correspondance directe", () => {
    const r = suggestionsDepuisCommunes([commune("Ponteilla", ["66300"])], analyserSaisie("Ponteilla 66300"));
    expect(r).toHaveLength(1);
    expect(r[0]!.postal_code).toBe("66300");
  });
  it("filtre sur le code postal saisi, l'ignore s'il ne correspond à rien", () => {
    const communes = [commune("Perpignan", ["66000", "66100"])];
    expect(suggestionsDepuisCommunes(communes, analyserSaisie("Perpignan 66100")).map((s) => s.postal_code)).toEqual(["66100"]);
    expect(suggestionsDepuisCommunes(communes, analyserSaisie("Perpignan 12345"))).toHaveLength(2);
  });
  it("code postal seul : communes par ordre alphabétique", () => {
    const r = suggestionsDepuisCommunes([commune("Thuir", ["66300"]), commune("Ponteilla", ["66300"]), commune("Trouillas", ["66300"])], analyserSaisie("66300"));
    expect(r.map((s) => s.name)).toEqual(["Ponteilla", "Thuir", "Trouillas"]);
  });
  it("ignore une commune sans code postal et tolère l'absence de centre", () => {
    const r = suggestionsDepuisCommunes([{ nom: "X", code: "1" }, { ...commune("Y", ["66000"]), centre: null }], analyserSaisie("Y"));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ lat: null, lng: null });
  });
});

describe("dédoublonnage", () => {
  it("même nom sans accents ni casse, codes postaux compatibles", () => {
    expect(memeVillage({ name: "Saint-Étienne", postal_code: "42000" }, { name: "saint etienne", postal_code: "42000" })).toBe(true);
    expect(memeVillage({ name: "Toulouges", postal_code: null }, { name: "Toulouges", postal_code: "66350" })).toBe(true);
    expect(memeVillage({ name: "Saint-Martin", postal_code: "38000" }, { name: "Saint-Martin", postal_code: "73000" })).toBe(false);
    expect(memeVillage({ name: "Thuir", postal_code: "66300" }, { name: "Ponteilla", postal_code: "66300" })).toBe(false);
  });
  it("renvoie la position du doublon", () => {
    const liste = [{ name: "Thuir", postal_code: "66300" }, { name: "Toulouges", postal_code: null }];
    expect(indexDoublon(liste, { name: "Toulouges", postal_code: "66350" })).toBe(1);
    expect(indexDoublon(liste, { name: "Canohès", postal_code: "66680" })).toBe(-1);
  });
});

describe("completerCodePostal", () => {
  const sugg = (liste: CommuneApi[], nom: string) => suggestionsDepuisCommunes(liste, analyserSaisie(nom));
  it("complète sans ambiguïté", () => {
    const r = completerCodePostal("Toulouges", sugg([commune("Toulouges", ["66350"])], "Toulouges"));
    expect(r).toMatchObject({ statut: "ok", suggestion: { postal_code: "66350" } });
  });
  it("propose les candidats si plusieurs codes postaux ou communes homonymes", () => {
    const r = completerCodePostal("Perpignan", sugg([commune("Perpignan", ["66000", "66100"])], "Perpignan"));
    expect(r.statut).toBe("ambigu");
    const h = completerCodePostal("Saint-Martin", sugg([commune("Saint-Martin", ["38000"], "38"), commune("Saint-Martin", ["73000"], "73")], "Saint-Martin"));
    expect(h).toMatchObject({ statut: "ambigu" });
  });
  it("ne devine pas une commune au nom approchant", () => {
    const r = completerCodePostal("Toulouge", sugg([commune("Toulouges", ["66350"])], "Toulouge"));
    expect(r.statut).toBe("ambigu");
  });
  it("introuvable sans suggestion", () => {
    expect(completerCodePostal("Zzz", [])).toEqual({ statut: "introuvable" });
  });
});

describe("avecSuggestion, codePostalValide, resumeArrets", () => {
  it("renseigne nom officiel, code postal et coordonnées", () => {
    const [s] = suggestionsDepuisCommunes([commune("Toulouges", ["66350"])], analyserSaisie("toulouges"));
    const v = avecSuggestion({ name: "toulouges", postal_code: null, notes: "portail" }, s!);
    expect(v).toMatchObject({ name: "Toulouges", postal_code: "66350", lat: 42.7, lng: 2.9, notes: "portail" });
  });
  it("code postal valide : 5 chiffres", () => {
    expect(codePostalValide("66350")).toBe(true);
    expect(codePostalValide("6635")).toBe(false);
    expect(codePostalValide(null)).toBe(false);
  });
  it("résumé des arrêts", () => {
    expect(resumeArrets([])).toBe("");
    expect(resumeArrets([{ type: "ramasse" }, { type: "ramasse" }, { type: "point_relais" }])).toBe("2 ramasses · 1 point relais");
    expect(resumeArrets([{ type: "point_relais" }, { type: "point_relais" }])).toBe("2 points relais");
  });
});
