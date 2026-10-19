import { describe, expect, it } from "vitest";
import { choisirCommerce, detecterProfessionnel, ressemblanceNoms } from "@/lib/colis/professionnel";

describe("detecterProfessionnel", () => {
  it("forme juridique dans le destinataire", () => {
    expect(detecterProfessionnel({ destinataire: "SARL Dupont Bâtiment", adresse: "3 rue des Lilas, 34150 Gignac" })).toMatchObject({ pro: true, raison: "forme_juridique" });
    expect(detecterProfessionnel({ destinataire: "Garage Martin S.A.S.", adresse: "x" })).toMatchObject({ pro: true, raison: "forme_juridique" });
  });

  it("mots-clés métier, dans le destinataire ou la 1re ligne de l'adresse", () => {
    expect(detecterProfessionnel({ destinataire: "Pharmacie du Centre", adresse: "1 place de l'Église, 34150 Aniane" })).toMatchObject({ pro: true, raison: "mot_cle" });
    expect(detecterProfessionnel({ destinataire: null, adresse: "Mairie, 2 place de la République, 34725 Saint-André" })).toMatchObject({ pro: true, nom: "Mairie" });
    expect(detecterProfessionnel({ destinataire: "Intermarché", adresse: "ZA Les Treilles" }).pro).toBe(true);
  });

  it("un particulier n'est pas un professionnel", () => {
    expect(detecterProfessionnel({ destinataire: "Jean Martin", adresse: "12 chemin des Vignes, 34150 Gignac" }).pro).toBe(false);
    expect(detecterProfessionnel({ destinataire: "Sandrine Sabatier", adresse: "4 rue Basse" }).pro).toBe(false);
    expect(detecterProfessionnel({ destinataire: "Mme Sasha", adresse: "Route de Lodève, 34150 Gignac" }).pro).toBe(false);
  });

  it("commerce connu à l'adresse dont le nom correspond", () => {
    const d = detecterProfessionnel({ destinataire: "Martin", adresse: "5 Grand Rue", commerces: [{ nom: "Boulangerie Martin", distanceM: 8 }] });
    expect(d).toEqual({ pro: true, nom: "Boulangerie Martin", raison: "commerce" });
  });
});

describe("choisirCommerce", () => {
  it("préfère le nom, sinon le seul lieu très proche, jamais un voisin au hasard", () => {
    const commerces = [
      { nom: "Tabac de la Poste", distanceM: 12 },
      { nom: "Pharmacie Durand", distanceM: 30 },
    ];
    const d = detecterProfessionnel({ destinataire: "Pharmacie Durand", adresse: "x" });
    expect(choisirCommerce(d, commerces, "Pharmacie Durand")?.nom).toBe("Pharmacie Durand");
    const autre = detecterProfessionnel({ destinataire: "SARL Bois", adresse: "x" });
    expect(choisirCommerce(autre, commerces, "SARL Bois")?.nom).toBe("Tabac de la Poste");
    expect(choisirCommerce(autre, [...commerces, { nom: "Café", distanceM: 20 }], "SARL Bois")).toBeNull();
    expect(choisirCommerce(detecterProfessionnel({ destinataire: "Jean", adresse: "x" }), commerces, "Jean")).toBeNull();
  });

  it("ressemblance des noms", () => {
    expect(ressemblanceNoms("Boulangerie Martin", "Martin Boulangerie Pâtisserie")).toBe(1);
    expect(ressemblanceNoms("SARL Durand", "Durand")).toBe(1);
    expect(ressemblanceNoms("Jean Dupont", "Pharmacie Martin")).toBe(0);
  });
});
