import { describe, expect, it } from "vitest";
import { GUIDES, guideDe, guideFiltre } from "@/lib/guides/roles";

describe("guides par rôle", () => {
  it("un guide pour chacun des 5 rôles", () => {
    expect(GUIDES.map((g) => g.role).sort()).toEqual(["chauffeur", "comptable", "direction", "manager"]);
  });
  it("masque les étapes des modules non souscrits", () => {
    const sans = guideFiltre(guideDe("chauffeur"), []);
    const etapes = sans.sections.flatMap((s) => s.etapes);
    expect(etapes.some((e) => e.module)).toBe(false);
    expect(sans.sections.find((s) => s.titre.startsWith("Tournée colis"))).toBeUndefined();
    const avec = guideFiltre(guideDe("chauffeur"), ["route_optimizer"]);
    expect(avec.sections.find((s) => s.titre.startsWith("Tournée colis"))?.etapes.length).toBe(3);
  });
  it("rôle inconnu : guide chauffeur", () => {
    expect(guideDe("x").role).toBe("chauffeur");
  });
});
