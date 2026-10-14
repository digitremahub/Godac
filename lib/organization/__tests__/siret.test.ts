import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyserIdentifiant, formaterSiret, luhnValide, sirenValide, siretValide } from "@/lib/organization/siret";
import { lireReponseRechercheEntreprises, normaliserNaf } from "@/lib/organization/recherche-entreprises";
import { libelleConvention, miseEnPlace, normaliserIdcc, reglesConvention, texteConventionCollective } from "@/lib/organization/idcc";
import { paysDe } from "@/lib/pays/pays";

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/recherche-entreprises.json"), "utf8"));

describe("SIRET / SIREN", () => {
  it("clé de Luhn", () => {
    expect(luhnValide("812345676")).toBe(true);
    expect(luhnValide("812345677")).toBe(false);
    expect(luhnValide("12a")).toBe(false);
  });

  it("SIREN et SIRET valides, espaces tolérés", () => {
    expect(sirenValide("812 345 676")).toBe(true);
    expect(siretValide("812 345 676 00017")).toBe(true);
    expect(siretValide("804 467 967 00027")).toBe(true);
    expect(siretValide("81234567600018")).toBe(false);
    // Clé globale juste mais SIREN faux.
    expect(luhnValide("81234567700007")).toBe(true);
    expect(siretValide("81234567700007")).toBe(false);
  });

  it("exception La Poste : Luhn ou somme des chiffres multiple de 5", () => {
    expect(siretValide("35600000000048")).toBe(true);
    expect(siretValide("35600000049837")).toBe(true);
    expect(siretValide("35600000000049")).toBe(false);
  });

  it("analyse d'une saisie libre", () => {
    expect(analyserIdentifiant("812.345.676.00017")).toEqual({ type: "siret", valeur: "81234567600017", siren: "812345676" });
    expect(analyserIdentifiant("812345676")).toEqual({ type: "siren", valeur: "812345676", siren: "812345676" });
    expect(analyserIdentifiant("81234567600018").type).toBe("invalide");
    expect(analyserIdentifiant("1234").type).toBe("invalide");
    expect(formaterSiret("81234567600017")).toBe("812 345 676 00017");
    expect(formaterSiret("812345676")).toBe("812 345 676");
  });
});

describe("réponse recherche-entreprises", () => {
  it("SIRET d'un établissement secondaire : adresse de l'établissement, siège pour l'adresse légale", () => {
    const info = lireReponseRechercheEntreprises(fixture, "812 345 676 00025")!;
    expect(info.siren).toBe("812345676");
    expect(info.siret).toBe("81234567600025");
    expect(info.nom).toBe("TRANSPORTS EXEMPLE (TREX)");
    expect(info.raisonSociale).toBe("TRANSPORTS EXEMPLE");
    expect(info.codeNaf).toBe("4941B");
    expect(info.libelleNaf).toBe("Transports routiers de fret de proximité");
    expect(info.formeJuridique).toBe("SAS");
    expect(info.adresse).toBe("3 AVENUE DU FRET 38070 SAINT-QUENTIN-FALLAVIER");
    expect(info.adresseSiege).toBe("12 RUE DES ROUTIERS 69007 LYON");
    expect(info.ville).toBe("SAINT-QUENTIN-FALLAVIER");
    expect(info.latitude).toBeCloseTo(45.6431);
    expect(info.longitude).toBeCloseTo(5.1102);
    expect(info.trancheEffectif).toBe("12");
    expect(info.libelleEffectif).toBe("20 à 49 salariés");
    expect(info.effectifEstime).toBe(20);
    expect(info.idcc).toEqual(["0016", "1486"]);
    expect(info.dateCreation).toBe("2015-06-01");
    expect(info.cessee).toBe(false);
  });

  it("SIREN seul : le siège", () => {
    const info = lireReponseRechercheEntreprises(fixture, "812345676")!;
    expect(info.siret).toBe("81234567600017");
    expect(info.codePostal).toBe("69007");
    expect(info.latitude).toBeCloseTo(45.7421);
  });

  it("réponses vides, inattendues ou partielles", () => {
    expect(lireReponseRechercheEntreprises(null, "812345676")).toBeNull();
    expect(lireReponseRechercheEntreprises({ results: [] }, "812345676")).toBeNull();
    expect(lireReponseRechercheEntreprises({ results: [{ siren: 42 }] }, "812345676")).toBeNull();
    expect(lireReponseRechercheEntreprises("<html>", "812345676")).toBeNull();
    const minimal = lireReponseRechercheEntreprises({ results: [{ siren: "812345676", siege: { latitude: "n/a" }, complements: { liste_idcc: "0016" } }] }, "812345676")!;
    expect(minimal.nom).toBe("812345676");
    expect(minimal.latitude).toBeNull();
    expect(minimal.idcc).toEqual([]);
    expect(minimal.codeNaf).toBeNull();
    expect(minimal.effectifEstime).toBeNull();
    const cessee = lireReponseRechercheEntreprises({ results: [{ siren: "812345676", etat_administratif: "C", tranche_effectif_salarie: "NN" }] }, "812345676")!;
    expect(cessee.cessee).toBe(true);
    expect(cessee.effectifEstime).toBe(1);
  });

  it("codes NAF", () => {
    expect(normaliserNaf("49.41A")).toBe("4941A");
    expect(normaliserNaf("4941a")).toBe("4941A");
    expect(normaliserNaf("49")).toBeNull();
    expect(normaliserNaf(null)).toBeNull();
  });
});

describe("conventions collectives", () => {
  it("normalisation IDCC", () => {
    expect(normaliserIdcc("16")).toBe("0016");
    expect(normaliserIdcc("IDCC 1486")).toBe("1486");
    expect(normaliserIdcc("0000")).toBeNull();
    expect(normaliserIdcc("12345")).toBeNull();
    expect(normaliserIdcc(undefined)).toBeNull();
  });

  it("IDCC 16 → règles transport ; autres → à paramétrer", () => {
    expect(reglesConvention(["0016"])).toEqual({ transport: true, autres: [] });
    expect(reglesConvention(["16", "1486"])).toEqual({ transport: true, autres: ["1486"] });
    expect(reglesConvention(["1486"])).toEqual({ transport: false, autres: ["1486"] });
    expect(reglesConvention([])).toEqual({ transport: false, autres: [] });
    expect(libelleConvention("16")).toBe("Transports routiers et activités auxiliaires du transport (IDCC 16)");
    expect(libelleConvention("9999")).toBe("Convention IDCC 9999");
    expect(texteConventionCollective([])).toBeNull();
    expect(texteConventionCollective(["0016", "1486"])).toBe(
      "Transports routiers et activités auxiliaires du transport (IDCC 16) ; Bureaux d'études techniques (Syntec) (IDCC 1486)",
    );
  });

  it("récapitulatif « Ce que GODAC a mis en place »", () => {
    const fr = paysDe("FR");
    const transport = miseEnPlace({ idcc: ["0016"], pays: fr, libelleEffectif: "10 à 19 salariés", effectif: 10 });
    const titres = transport.map((l) => l.titre);
    expect(titres).toContain("Règles de paie du transport routier");
    expect(titres).toContain("Durées d'équivalence");
    expect(titres).toContain("Frais de déplacement conventionnels");
    expect(titres).not.toContain("Autre convention à paramétrer");
    expect(transport.find((l) => l.titre === "Durées d'équivalence")!.detail).toContain("186,33 h");
    expect(transport.find((l) => l.titre === "Frais de déplacement conventionnels")!.detail).toContain("16,36 €");
    expect(transport.find((l) => l.titre === "Protection des données")!.detail).toContain("CNIL");
    expect(transport.every((l) => l.ton === "ok")).toBe(true);

    const syntec = miseEnPlace({ idcc: ["1486"], pays: fr });
    expect(syntec.map((l) => l.titre)).not.toContain("Règles de paie du transport routier");
    const autre = syntec.find((l) => l.titre === "Autre convention à paramétrer")!;
    expect(autre.ton).toBe("attention");
    expect(autre.detail).toContain("IDCC 16");
    expect(autre.detail).toContain("expert-comptable");

    const sans = miseEnPlace({ idcc: [], pays: fr });
    expect(sans[0]!.ton).toBe("attention");

    const be = miseEnPlace({ idcc: ["0016"], pays: paysDe("BE") });
    expect(be.map((l) => l.titre)).not.toContain("Règles de paie du transport routier");
    expect(be.find((l) => l.titre === "Paie")!.ton).toBe("attention");
  });
});
