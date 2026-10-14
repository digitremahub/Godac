import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lireReponseRechercheEntreprises } from "@/lib/organization/recherche-entreprises";
import { champsAEcrire, comparerFiche, valeursFiche } from "@/lib/organization/fiche-entreprise";

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/recherche-entreprises.json"), "utf8"));

describe("fiche entreprise : rien n'est écrasé sans confirmation", () => {
  const info = lireReponseRechercheEntreprises(fixture, "81234567600017")!;

  it("organisation vide : tout se remplit", () => {
    const champs = comparerFiche({ country: "FR" }, info);
    expect(champs.find((c) => c.cle === "country")!.etat).toBe("identique");
    const ecrits = champsAEcrire(champs, []);
    expect(ecrits).toEqual(
      expect.arrayContaining(["legal_name", "siret", "siren", "legal_form", "ape_code", "legal_address", "convention_collective", "idcc", "depot_address"]),
    );
    expect(ecrits).not.toContain("country");
    expect(valeursFiche(info).idcc).toEqual(["0016", "1486"]);
    expect(valeursFiche(info).legal_name).toBe("TRANSPORTS EXEMPLE");
    expect(valeursFiche(info).depot_address).toBe("12 RUE DES ROUTIERS 69007 LYON");
  });

  it("valeurs déjà saisies : conservées sauf confirmation, identiques ignorées", () => {
    const champs = comparerFiche(
      { siret: "812 345 676 00017", ape_code: "49.41b", legal_form: "SARL", depot_address: "1 rue du Dépôt, 69007 Lyon", country: "BE", idcc: ["0016", "1486"] },
      info,
    );
    const etat = (cle: string) => champs.find((c) => c.cle === cle)!.etat;
    expect(etat("siret")).toBe("identique");
    expect(etat("ape_code")).toBe("identique");
    expect(etat("idcc")).toBe("identique");
    expect(etat("legal_form")).toBe("different");
    expect(etat("depot_address")).toBe("different");
    expect(etat("country")).toBe("different");
    const sansConfirmation = champsAEcrire(champs, []);
    expect(sansConfirmation).not.toContain("legal_form");
    expect(sansConfirmation).not.toContain("depot_address");
    expect(sansConfirmation).not.toContain("siret");
    expect(champsAEcrire(champs, ["legal_form"])).toContain("legal_form");
  });
});
