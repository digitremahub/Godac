import { describe, expect, it } from "vitest";
import { arborescence, choixRangement, libelleEmplacement, type EmplacementLu } from "@/lib/stock/emplacements";

const e = (id: string, genre: "zone" | "emplacement", code: string, parent_id: string | null = null, actif = true, site_id = "s1"): EmplacementLu => ({ id, site_id, parent_id, genre, type_zone: genre === "zone" ? "quai" : null, code, libelle: null, actif });
const tous = [e("z2", "zone", "Q2"), e("z1", "zone", "Q1"), e("a", "emplacement", "Q1-10", "z1"), e("b", "emplacement", "Q1-2", "z1"), e("c", "emplacement", "Q1-3", "z1", false), e("x", "emplacement", "A-1", "z9", true, "s2")];

describe("zones et emplacements", () => {
  it("arborescence d'un dépôt : codes triés naturellement, désactivés masqués", () => {
    const arbre = arborescence("s1", tous);
    expect(arbre.map((z) => z.zone.code)).toEqual(["Q1", "Q2"]);
    expect(arbre[0]!.emplacements.map((x) => x.code)).toEqual(["Q1-2", "Q1-10"]);
    expect(arborescence("s1", tous, true)[0]!.emplacements).toHaveLength(3);
  });
  it("libellé : zone puis emplacement", () => {
    expect(libelleEmplacement(tous[2]!, tous)).toBe("Q1 › Q1-10");
    expect(libelleEmplacement({ ...tous[1]!, libelle: "Quai froid" }, tous)).toBe("Q1 (Quai froid)");
  });
  it("choix de rangement : emplacements, et zones qui n'en ont pas", () => {
    expect(choixRangement("s1", tous).map((c) => c.libelle)).toEqual(["Q1 › Q1-2", "Q1 › Q1-10", "Q2"]);
  });
});
