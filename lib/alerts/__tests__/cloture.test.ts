import { describe, expect, it } from "vitest";
import { alertesAClore } from "@/lib/alerts/cloture";

const ouvertes = [
  { id: "a1", type: "tournee_retard", related_id: "r1" },
  { id: "a2", type: "tournee_retard", related_id: "r2" },
  { id: "a3", type: "tournee_sans_chauffeur", related_id: "p1" },
  { id: "a4", type: "tournee_non_demarree", related_id: null },
  { id: "a5", type: "price_anomaly", related_id: "x" },
];

describe("clôture automatique des alertes", () => {
  it("clôt celles dont la condition a disparu, garde les autres", () => {
    const conditions = new Map([
      ["tournee_retard", new Set(["r1"])],
      ["tournee_sans_chauffeur", new Set<string>()],
    ]);
    expect(alertesAClore(ouvertes, conditions)).toEqual(["a2", "a3"]);
  });
  it("ne touche ni aux types non évalués ni aux alertes sans élément lié", () => {
    expect(alertesAClore(ouvertes, new Map([["tournee_non_demarree", new Set<string>()]]))).toEqual([]);
    expect(alertesAClore(ouvertes, new Map())).toEqual([]);
  });
});
