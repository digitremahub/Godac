import { describe, expect, it } from "vitest";
import { colonneManquante, groupesSansColonne, selection } from "@/lib/ticpe/colonnes";

const GROUPES = ["ticpe_justificatif, ticpe_justificatif_ref", "ticpe_doublon_leve_le", "ticpe_zone, pays_achat"];

describe("lecture tolérante des colonnes de migrations", () => {
  it("nom de la colonne manquante", () => {
    expect(colonneManquante("column fuel_entries.ticpe_zone does not exist")).toBe("ticpe_zone");
    expect(colonneManquante('column "pays_achat" does not exist')).toBe("pays_achat");
    expect(colonneManquante("Could not find the 'ticpe_doublon_leve_le' column of 'fuel_entries' in the schema cache")).toBe("ticpe_doublon_leve_le");
    expect(colonneManquante("permission denied")).toBeNull();
    expect(colonneManquante(null)).toBeNull();
  });
  it("retire le groupe qui contient la colonne, garde les autres", () => {
    expect(groupesSansColonne(GROUPES, "pays_achat")).toEqual(GROUPES.slice(0, 2));
    expect(groupesSansColonne(GROUPES, "ticpe_doublon_leve_le")).toEqual([GROUPES[0], GROUPES[2]]);
    expect(groupesSansColonne(GROUPES, "autre")).toEqual(GROUPES);
  });
  it("sélection complète puis réduite", () => {
    expect(selection("id, vehicle_id", GROUPES)).toBe("id, vehicle_id, ticpe_justificatif, ticpe_justificatif_ref, ticpe_doublon_leve_le, ticpe_zone, pays_achat");
    expect(selection("id", [])).toBe("id");
  });
});
