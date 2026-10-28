import { describe, expect, it } from "vitest";
import { ECRANS, MODULES_AVEC_CODE, TOUS_LES_ROLES, deciderAcces, estSectionRepliee, estVisibleAuMenu, menuAffiche, menuPour } from "@/lib/acces/catalogue";

const tout = new Set<string>(MODULES_AVEC_CODE);

describe("menu de la direction allégé", () => {
  const sections = menuAffiche("direction", tout);
  const visiblesParDefaut = sections.filter((s) => !estSectionRepliee(s.id, "direction")).flatMap((s) => s.ecrans);

  it("Administration et Aide repliées par défaut, entrées rares rangées dans Administration", () => {
    expect(estSectionRepliee("admin", "direction")).toBe(true);
    expect(estSectionRepliee("aide", "direction")).toBe(true);
    const admin = sections.find((s) => s.id === "admin")!.ecrans.map((e) => e.id);
    expect(admin).toEqual(expect.arrayContaining(["admin.organisation", "admin.abonnement", "admin.journal", "equipe.registre", "flotte.badges"]));
    expect(sections.find((s) => s.id === "equipe")!.ecrans.map((e) => e.id)).not.toContain("equipe.registre");
    expect(sections.find((s) => s.id === "flotte")!.ecrans.map((e) => e.id)).not.toContain("flotte.badges");
  });

  it("au plus 28 entrées dépliées au lieu de 32 (27 avant le module Stock, une entrée « Stock » de plus), le carburant et la paie restent en vue", () => {
    expect(visiblesParDefaut.length).toBeLessThanOrEqual(28);
    const ids = visiblesParDefaut.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["carburant.pleins", "carburant.revue_ocr", "equipe.paie", "equipe.utilisateurs", "exploitation.planning"]));
  });

  it("aucun accès retiré : toutes les entrées du menu restent présentes, et ouvrables", () => {
    const avant = ECRANS.filter((e) => estVisibleAuMenu(e, "direction", tout)).map((e) => e.id).sort();
    const apres = sections.flatMap((s) => s.ecrans.map((e) => e.id)).sort();
    expect(apres).toEqual(avant);
    for (const id of apres) expect(deciderAcces(ECRANS.find((e) => e.id === id)!, "direction", tout).ok, id).toBe(true);
  });

  it("les autres rôles gardent un menu sans section repliée, Badges QR dans Flotte", () => {
    for (const role of TOUS_LES_ROLES.filter((r) => r !== "direction")) for (const s of menuPour(role, tout)) expect(estSectionRepliee(s.id, role), `${role} ${s.id}`).toBe(false);
    expect(menuPour("manager", tout).find((s) => s.id === "flotte")!.ecrans.map((e) => e.id)).toContain("flotte.badges");
  });
});
