import { describe, expect, it } from "vitest";
import { MESSAGE_ERREUR_MAX, assainirChemin, assainirRapport, assainirTexte } from "@/lib/observabilite/erreurs-client";

describe("assainissement des erreurs d'affichage", () => {
  it("retire e-mails, identifiants, jetons, numéros et paramètres d'URL", () => {
    const t = assainirTexte("Échec pour jean.dupont@exemple.fr tournée 3f2c9a52-1b2d-4c3e-8f90-123456789abc tel 06 12 34 56 78 sur https://godac.app/x?token=abcdef&u=1 jeton eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF2QT4fw");
    expect(t).not.toMatch(/jean\.dupont|3f2c9a52|06 12|token=|eyJhbGci/);
    expect(t).toContain("[e-mail]");
    expect(t).toContain("[id]");
  });
  it("borne la longueur", () => {
    expect(assainirTexte("a ".repeat(1000))).toHaveLength(MESSAGE_ERREUR_MAX);
  });
  it("le chemin perd paramètres et identifiants", () => {
    expect(assainirChemin("/exploitation/colis/3f2c9a52-1b2d-4c3e-8f90-123456789abc?run=1#x")).toBe("/exploitation/colis/:id");
    expect(assainirChemin("/livreur")).toBe("/livreur");
    expect(assainirChemin("/equipe/12345/fiche")).toBe("/equipe/:id/fiche");
  });
  it("rapport valide, ou refusé", () => {
    expect(assainirRapport({ origine: "livreur", message: "boom", digest: "123", chemin: "/livreur?x=1" })).toEqual({ origine: "livreur", message: "boom", digest: "123", chemin: "/livreur" });
    expect(assainirRapport({ origine: "inconnue", message: "boom" })).toBeNull();
    expect(assainirRapport({ origine: "racine", message: "" })).toBeNull();
    expect(assainirRapport({ origine: "racine", message: 42 })).toBeNull();
    expect(assainirRapport(null)).toBeNull();
    expect(assainirRapport("texte")).toBeNull();
  });
});
