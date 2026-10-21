import { describe, expect, it } from "vitest";
import { champsManquants, csvRegistre, estSorti, libelleContrat, ordreRegistre, tempsPartiel, titreTravailRequis, type EntreeRegistre } from "@/lib/registre/personnel";
import { BOM } from "@/lib/paie/csv";

// Identités fictives.
const complet: EntreeRegistre = {
  userId: "u1",
  nomAffiche: "Camille Exemple",
  nom: "EXEMPLE",
  prenoms: "Camille Marie",
  nationalite: "Française",
  dateNaissance: "1990-04-12",
  sexe: "F",
  emploi: "Conductrice SPL",
  qualification: "Groupe 7, coefficient 150M",
  dateEntree: "2021-03-01",
  dateSortie: null,
  typeContrat: "cdi",
  tempsPartiel: false,
  agenceInterim: null,
  titreTravailType: null,
  titreTravailNumero: null,
  actif: true,
};

describe("registre unique du personnel", () => {
  it("fiche complète : rien ne manque", () => {
    expect(champsManquants(complet)).toEqual([]);
  });

  it("signale les mentions obligatoires manquantes", () => {
    const m = champsManquants({ ...complet, nom: null, prenoms: " ", nationalite: null, sexe: null, dateEntree: null, typeContrat: null });
    expect(m).toEqual(["Nom", "Prénoms", "Nationalité", "Sexe", "Date d'entrée", "Type de contrat"]);
  });

  it("salarié sorti sans date de sortie", () => {
    expect(champsManquants({ ...complet, actif: false })).toEqual(["Date de sortie"]);
    expect(champsManquants({ ...complet, actif: false, dateSortie: "2026-06-30" })).toEqual([]);
    expect(champsManquants({ ...complet, dateSortie: "2020-01-01" })).toContain("Date de sortie antérieure à l'entrée");
  });

  it("titre de travail exigé hors UE / EEE / Suisse", () => {
    expect(titreTravailRequis("Française")).toBe(false);
    expect(titreTravailRequis("portugaise")).toBe(false);
    expect(titreTravailRequis("Grecque")).toBe(false);
    expect(titreTravailRequis("Suisse")).toBe(false);
    expect(titreTravailRequis("Norvégien")).toBe(false);
    expect(titreTravailRequis("Marocaine")).toBe(true);
    expect(titreTravailRequis("Sénégalais")).toBe(true);
    expect(titreTravailRequis(null)).toBe(false);
    const etranger = { ...complet, nationalite: "Tunisienne" };
    expect(champsManquants(etranger)).toEqual(["Type du titre de travail", "N° du titre de travail"]);
    expect(champsManquants({ ...etranger, titreTravailType: "Carte de séjour pluriannuelle", titreTravailNumero: "0000000000" })).toEqual([]);
  });

  it("intérim : entreprise de travail temporaire exigée", () => {
    expect(champsManquants({ ...complet, typeContrat: "interim" })).toEqual(["Entreprise de travail temporaire"]);
    expect(libelleContrat({ typeContrat: "interim", tempsPartiel: false, agenceInterim: "Agence Fictive" })).toBe("Intérim (mise à disposition) — Agence Fictive");
    expect(libelleContrat({ typeContrat: "cdd", tempsPartiel: true, agenceInterim: null })).toBe("CDD, temps partiel");
  });

  it("ordre d'embauche, dates inconnues à la fin", () => {
    const o = ordreRegistre([
      { ...complet, userId: "c", dateEntree: null, nom: "C" },
      { ...complet, userId: "b", dateEntree: "2024-01-01", nom: "B" },
      { ...complet, userId: "a", dateEntree: "2019-05-01", nom: "A" },
      { ...complet, userId: "a2", dateEntree: "2019-05-01", nom: "Aa" },
    ]);
    expect(o.map((e) => e.userId)).toEqual(["a", "a2", "b", "c"]);
  });

  it("CSV : rang entier, dates françaises, BOM", () => {
    const csv = csvRegistre([complet]);
    expect(csv.startsWith(BOM)).toBe(true);
    const ligne = csv.split("\r\n")[1]!;
    expect(ligne.startsWith("1;EXEMPLE;Camille Marie;Française;12/04/1990;Femme;")).toBe(true);
    expect(ligne).toContain("01/03/2021");
  });

  it("temps partiel et sortie", () => {
    expect(tempsPartiel(104)).toBe(true);
    expect(tempsPartiel(151.67)).toBe(false);
    expect(tempsPartiel(null)).toBe(false);
    expect(estSorti({ actif: true, dateSortie: "2026-01-31" }, "2026-10-21")).toBe(true);
    expect(estSorti({ actif: true, dateSortie: null }, "2026-10-21")).toBe(false);
  });
});
