import { describe, expect, it } from "vitest";
import { cleVillage, normaliserRecherche, rechercherVillages } from "../recherche-villages";

const routes = [
  {
    id: "r1",
    tourNumber: "T101",
    villages: [
      { id: "v1", name: "Saint-Étienne-de-Crossey", postal_code: "38960" },
      { id: "v2", name: "Voiron", postal_code: "38500" },
    ],
  },
  { id: "r2", tourNumber: "T102", villages: [{ id: "v3", name: "Œuilly", postal_code: "51480" }] },
  { id: "r3", tourNumber: "R1", villages: [], renfortVillageIds: ["v2"] },
];

describe("normaliserRecherche", () => {
  it("retire accents, casse, tirets et ligatures", () => {
    expect(normaliserRecherche("  Saint-ÉTIENNE  ")).toBe("saint etienne");
    expect(normaliserRecherche("Œuilly")).toBe("oeuilly");
    expect(normaliserRecherche("L’Isle")).toBe("l isle");
  });
});

describe("rechercherVillages", () => {
  it("recherche vide : inactive", () => {
    expect(rechercherVillages(routes, "  ").active).toBe(false);
  });

  it("trouve sans accents ni casse et met le village en évidence", () => {
    const r = rechercherVillages(routes, "saint etienne");
    expect([...r.routeIds]).toEqual(["r1"]);
    expect(r.villages.has(cleVillage("r1", routes[0]!.villages[0]!, 0))).toBe(true);
    expect(r.nbVillages).toBe(1);
  });

  it("trouve par début de code postal", () => {
    const r = rechercherVillages(routes, "385");
    expect([...r.villages]).toEqual(["r1:v2"]);
    expect(rechercherVillages(routes, "500").nbVillages).toBe(0);
  });

  it("ajoute le renfort qui couvre le village trouvé", () => {
    const r = rechercherVillages(routes, "VOIRON");
    expect(r.routeIds.has("r1")).toBe(true);
    expect(r.routeIds.has("r3")).toBe(true);
  });

  it("gère les ligatures", () => {
    expect(rechercherVillages(routes, "oeuil").routeIds.has("r2")).toBe(true);
  });

  it("aucun résultat", () => {
    const r = rechercherVillages(routes, "Grenoble");
    expect(r.active).toBe(true);
    expect(r.routeIds.size).toBe(0);
  });

  it("le numéro de tournée reste cherchable", () => {
    expect([...rechercherVillages(routes, "t102").routeIds]).toEqual(["r2"]);
  });
});
