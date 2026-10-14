import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { nettoyerEtiquette } = await import("@/lib/colis/lecture-ia");

describe("lecture d'étiquette (nettoyage de la réponse IA)", () => {
  it("normalise le téléphone et convertit le poids", () => {
    expect(nettoyerEtiquette({ adresse: " 12 rue des Lilas, 69230 Saint-Genis-Laval ", destinataire: "Julie Martin", code: "AB123", telephone: "+33 6 12 34 56 78", poids: 0.85 })).toEqual({
      adresse: "12 rue des Lilas, 69230 Saint-Genis-Laval",
      destinataire: "Julie Martin",
      code: "AB123",
      telephone: "06 12 34 56 78",
      poids: 0.85,
    });
  });
  it("retrouve le numéro dans un champ bavard et accepte un poids en texte", () => {
    const lu = nettoyerEtiquette({ adresse: null, destinataire: null, code: null, telephone: "Tél. mobile : 06.12.34.56.78", poids: "850 g" });
    expect(lu.telephone).toBe("06 12 34 56 78");
    expect(lu.poids).toBe(0.85);
  });
  it("numéro national d'un autre pays selon le pays de l'entreprise", () => {
    expect(nettoyerEtiquette({ telephone: "0470 12 34 56", poids: null }, "BE").telephone).toBe("+32470123456");
  });
  it("champs absents ou illisibles → null", () => {
    expect(nettoyerEtiquette({ telephone: "illisible", poids: -2 })).toMatchObject({ adresse: null, telephone: null, poids: null });
  });
});
