import { describe, expect, it } from "vitest";
import { dureeJourPrevueMinutes, entreeAClore, estimerSortie, sortieDepuisHeureParis, validerCorrection } from "@/lib/time-clock/regularisation";

const maintenant = new Date("2026-10-27T05:00:00Z");

describe("entreeAClore", () => {
  it("ouverte depuis plus de 16 h", () => expect(entreeAClore("2026-10-26T12:00:00Z", maintenant)).toBe(true));
  it("d'un jour précédent (Paris), même si moins de 16 h", () => expect(entreeAClore("2026-10-26T20:30:00Z", maintenant)).toBe(true));
  it("entrée du jour : laissée ouverte", () => expect(entreeAClore("2026-10-27T04:30:00Z", maintenant)).toBe(false));
});

describe("estimerSortie", () => {
  const entree = "2026-10-26T06:00:00Z";
  it("fin planifiée plausible", () => {
    expect(estimerSortie({ entree, finsPlanifiees: ["2026-10-26T14:00:00Z", null], dureePrevueMinutes: 420, maintenant })).toEqual({ sortie: "2026-10-26T14:00:00.000Z", source: "planning" });
  });
  it("fin planifiée absurde (avant l'entrée ou trop tardive) : durée prévue", () => {
    expect(estimerSortie({ entree, finsPlanifiees: ["2026-10-26T05:00:00Z", "2026-10-27T04:00:00Z"], dureePrevueMinutes: 420, maintenant })).toEqual({ sortie: "2026-10-26T13:00:00.000Z", source: "duree_prevue" });
  });
  it("rien de connu : à saisir", () => {
    expect(estimerSortie({ entree, finsPlanifiees: [], dureePrevueMinutes: null, maintenant })).toEqual({ sortie: null, source: "a_saisir" });
  });
});

describe("dureeJourPrevueMinutes", () => {
  it("151,67 h par mois = 7 h par jour", () => expect(dureeJourPrevueMinutes(151.67)).toBe(420));
  it("inconnue", () => expect(dureeJourPrevueMinutes(null)).toBeNull());
});

describe("validerCorrection", () => {
  const base = { entree: "2026-10-26T06:00:00Z", maintenant };
  it("motif obligatoire", () => expect(validerCorrection({ ...base, sortie: "2026-10-26T14:00:00Z", motif: " " }).ok).toBe(false));
  it("sortie avant l'entrée refusée", () => expect(validerCorrection({ ...base, sortie: "2026-10-26T05:00:00Z", motif: "oubli" }).ok).toBe(false));
  it("sortie dans le futur refusée", () => expect(validerCorrection({ ...base, sortie: "2026-10-28T05:00:00Z", motif: "oubli" }).ok).toBe(false));
  it("plus de 24 h refusé", () => expect(validerCorrection({ entree: "2026-10-25T06:00:00Z", sortie: "2026-10-26T07:00:00Z", motif: "oubli", maintenant }).ok).toBe(false));
  it("correction valide", () => expect(validerCorrection({ ...base, sortie: "2026-10-26T14:00:00Z", motif: "Oubli de badge" })).toMatchObject({ ok: true, motif: "Oubli de badge" }));
});

describe("sortieDepuisHeureParis", () => {
  it("même jour (hiver : Paris = UTC+1)", () => expect(sortieDepuisHeureParis("2026-12-01T06:00:00Z", "16:30")).toBe("2026-12-01T15:30:00.000Z"));
  it("heure avant l'entrée : le lendemain (équipe de nuit)", () => expect(sortieDepuisHeureParis("2026-12-01T21:00:00Z", "05:00")).toBe("2026-12-02T04:00:00.000Z"));
  it("format invalide", () => expect(sortieDepuisHeureParis("2026-12-01T06:00:00Z", "25:00")).toBeNull());
});
