import { describe, expect, it } from "vitest";
import { lireAgregats } from "@/lib/accueil/agregats";

describe("agrégats de l'accueil direction", () => {
  it("lit la réponse de la fonction SQL", () => {
    expect(lireAgregats({ cout_mois: "1234.5", cout_par_vehicule: [{ name: "AB-123-CD", value: 900 }], tournees_par_service: [{ name: "Nord", value: 4 }] })).toEqual({
      coutMois: 1234.5,
      coutParVehicule: [{ name: "AB-123-CD", value: 900 }],
      tourneesParService: [{ name: "Nord", value: 4 }],
    });
  });
  it("réponse absente ou mal formée : null (repli sur l'ancien calcul)", () => {
    expect(lireAgregats(null)).toBeNull();
    expect(lireAgregats({ cout_mois: 1 })).toBeNull();
    expect(lireAgregats({ cout_mois: "x", cout_par_vehicule: [], tournees_par_service: [] })).toBeNull();
  });
});
