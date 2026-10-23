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
    expect(avec.sections.find((s) => s.titre.startsWith("Tournée colis"))?.etapes.length).toBe(4);
  });
  it("compte GO Navigation : guide dédié en 5 étapes, liens dans l'offre seulement", () => {
    const g = guideDe("manager", true, { goNavigation: true });
    expect(g.titre).toBe("Guide GO Navigation");
    expect(g.sections[0]!.etapes).toHaveLength(5);
    const liens = g.sections.flatMap((s) => s.etapes.map((e) => e.lien?.href.split("?")[0] ?? ""));
    for (const h of liens) expect(["/exploitation/colis", "/livreur/navigation", "/exploitation/historique/colis", "/aide/faq", "/account"]).toContain(h);
  });
  it("direction : l'étape « Valider les bulletins du mois » est présente", () => {
    const etapes = guideDe("direction").sections.flatMap((s) => s.etapes.map((e) => e.titre));
    expect(etapes).toContain("Valider les bulletins du mois");
  });
  it("rôle inconnu : guide chauffeur", () => {
    expect(guideDe("x").role).toBe("chauffeur");
  });
});

describe("guide du manager : accueil", () => {
  it("décrit le nouvel accueil (équipe, véhicules, amendes, notifications), sans paie", () => {
    const g = guideDe("manager");
    expect(g.sections[0]!.titre).toBe("Votre accueil");
    expect(g.sections[0]!.etapes.map((e) => e.titre)).toEqual([
      "Votre équipe en un coup d'œil",
      "Les véhicules de votre service",
      "Amendes et contestations ouvertes",
      "Notifications de l'exploitation et de la direction",
    ]);
    const liens = g.sections[0]!.etapes.map((e) => e.lien?.href ?? "");
    expect(liens.some((h) => h.startsWith("/equipe/paie"))).toBe(false);
  });
  it("le manager qui conduit le retrouve, après les écrans du chauffeur ; l'exploitation non", () => {
    expect(guideDe("manager", true).sections.some((s) => s.titre === "Votre accueil")).toBe(true);
    expect(guideDe("exploitation").sections.some((s) => s.titre === "Votre accueil")).toBe(false);
  });
});
