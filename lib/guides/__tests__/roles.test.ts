import { describe, expect, it } from "vitest";
import { GUIDES, guideDe, guideFiltre } from "@/lib/guides/roles";

describe("guides par rôle", () => {
  it("un guide pour chacun des 5 rôles", () => {
    expect(GUIDES.map((g) => g.role).sort()).toEqual(["chauffeur", "comptable", "direction", "exploitation", "manager"]);
  });
  it("exploitation : guide dédié, avec les écrans du chauffeur quand elle conduit", () => {
    expect(guideDe("exploitation").titre).toBe("Guide de l'exploitation");
    const conduit = guideDe("exploitation", true);
    expect(conduit.role).toBe("exploitation");
    expect(conduit.sections[0]!.titre).toBe("Bien démarrer");
    // Jamais la paie dans le guide de l'exploitation.
    const liens = guideDe("exploitation").sections.flatMap((s) => s.etapes.map((e) => e.lien?.href ?? ""));
    expect(liens.some((h) => h.startsWith("/equipe/paie") || h.startsWith("/admin/"))).toBe(false);
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
