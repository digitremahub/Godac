import { describe, expect, it } from "vitest";
import { ACTIONS_LOT, CODES_PAR_ACTION, LOT_MAX, ROLES_CORRECTION_PLEIN, actionPourPoint, normaliserLot, pointsCorrigeablesEnLot } from "../corrections";
import type { CodeControle, PointARegler } from "../controles";

const point = (code: CodeControle, id: string | null, type: "plein" | "vehicule" | "reglages" = "plein", cle = `${code}:${id}`): PointARegler => ({
  cle,
  code,
  gravite: "bloquant",
  titre: code,
  detail: code,
  lien: "/x",
  objet: { type, id },
});

describe("points corrigeables en lot", () => {
  it("chaque action couvre ses points de plein", () => {
    expect(actionPourPoint(point("sans_justificatif", "p1"))).toBe("justificatif");
    expect(actionPourPoint(point("zone_a_verifier", "p1"))).toBe("zone");
    expect(actionPourPoint(point("hors_france", "p1"))).toBe("zone");
    expect(actionPourPoint(point("doublon", "p1"))).toBe("doublon");
  });
  it("les autres points ne se corrigent pas en lot (véhicule, réglages, plafond, taux…)", () => {
    expect(actionPourPoint(point("ptac_inconnu", "v1", "vehicule"))).toBeNull();
    expect(actionPourPoint(point("taux_manquant", null, "reglages"))).toBeNull();
    expect(actionPourPoint(point("plein_non_valide", "p1"))).toBeNull();
    expect(actionPourPoint(point("sans_justificatif", null))).toBeNull();
    // Un point de plein sur un objet véhicule n'est pas un plein.
    expect(actionPourPoint(point("sans_justificatif", "v1", "vehicule"))).toBeNull();
  });
  it("aucune action ne modifie les litres ni les montants : seules trois actions TICPE existent", () => {
    expect([...ACTIONS_LOT]).toEqual(["justificatif", "zone", "doublon"]);
    expect(Object.keys(CODES_PAR_ACTION).sort()).toEqual([...ACTIONS_LOT].sort());
  });
  it("regroupement par action, un plein une seule fois par action", () => {
    const g = pointsCorrigeablesEnLot([point("sans_justificatif", "p1"), point("sans_justificatif", "p1", "plein", "autre-cle"), point("sans_justificatif", "p2"), point("doublon", "p3"), point("zone_a_verifier", "p1"), point("ptac_inconnu", "v1", "vehicule")]);
    expect(g.justificatif.map((x) => x.pleinId)).toEqual(["p1", "p2"]);
    expect(g.doublon.map((x) => x.pleinId)).toEqual(["p3"]);
    expect(g.zone.map((x) => x.pleinId)).toEqual(["p1"]);
  });
  it("lot borné et sans doublon", () => {
    expect(normaliserLot(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(normaliserLot(Array.from({ length: 80 }, (_, i) => `id${i}`))).toHaveLength(LOT_MAX);
  });
});

describe("rôles de correction", () => {
  it("l'encadrement et le comptable ; jamais le chauffeur", () => {
    expect([...ROLES_CORRECTION_PLEIN].sort()).toEqual(["comptable", "direction", "exploitation", "manager"]);
    expect(ROLES_CORRECTION_PLEIN).not.toContain("chauffeur" as never);
  });
});
