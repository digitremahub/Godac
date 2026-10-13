import { describe, expect, it } from "vitest";
import { chooseCommune, departementsFromPostalCode, postalCodeFromAddress, type CommuneCandidate } from "@/lib/geo/communes";

const c = (nom: string, code: string, dep: string, cps: string[], lng: number, lat: number): CommuneCandidate => ({
  nom,
  code,
  codesPostaux: cps,
  departement: { code: dep, nom: dep },
  centre: { type: "Point", coordinates: [lng, lat] },
});
// Résultats triés par population, comme l'API.
const saintMartin = [
  c("Saint-Martin", "11111", "65", ["65360"], 0.1, 43.2),
  c("Saint-Martin", "22222", "32", ["32300"], 0.4, 43.5),
  c("Saint-Martin", "33333", "67", ["67220"], 7.3, 48.3),
];

describe("choix de la commune", () => {
  it("par défaut, la première (la plus peuplée)", () => {
    expect(chooseCommune("Saint-Martin", saintMartin)?.inseeCode).toBe("11111");
  });
  it("code postal du village", () => {
    expect(chooseCommune("St Martin", saintMartin, { postalCode: "67220" })?.inseeCode).toBe("33333");
  });
  it("département du village si le code postal ne correspond pas exactement", () => {
    expect(chooseCommune("Saint-Martin", saintMartin, { postalCode: "32000" })?.inseeCode).toBe("22222");
  });
  it("la plus proche du dépôt", () => {
    expect(chooseCommune("Saint-Martin", saintMartin, { depot: { lat: 48.5, lng: 7.7 } })?.inseeCode).toBe("33333");
  });
  it("département du dépôt quand le dépôt n'est pas géolocalisé", () => {
    expect(chooseCommune("Saint-Martin", saintMartin, { depotPostalCode: "32700" })?.inseeCode).toBe("22222");
  });
  it("nom exact préféré à un résultat approchant", () => {
    const list = [c("Martinet", "44444", "85", ["85150"], -1.6, 46.6), c("Martin", "55555", "01", ["01000"], 5, 46)];
    expect(chooseCommune("Martin", list)?.inseeCode).toBe("55555");
  });
  it("aucun résultat exploitable", () => {
    expect(chooseCommune("X", [])).toBeNull();
    expect(chooseCommune("X", [{ nom: "X", code: "1", centre: null }])).toBeNull();
  });
  it("codes postaux", () => {
    expect(departementsFromPostalCode("20250")).toEqual(["2A", "2B"]);
    expect(departementsFromPostalCode("97400")).toEqual(["974"]);
    expect(departementsFromPostalCode("abc")).toEqual([]);
    expect(postalCodeFromAddress("12 rue des Lilas, 38500 Voiron")).toBe("38500");
    expect(postalCodeFromAddress(null)).toBeNull();
  });
});
