import { describe, expect, it } from "vitest";
import { ECRANS, MODULES_AVEC_CODE } from "@/lib/acces/catalogue";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import { PAS_MAX, PAS_MIN, PREMIERS_PAS_FERME, PREMIERS_PAS_REPLIE_PAR_DEFAUT, PREMIERS_PAS_VU, afficherPremiersPas, clePremiersPas, libellePremiersPas, premiersPas } from "@/lib/guides/premiers-pas";
import { TOUS_LES_ROLES } from "@/lib/acces/catalogue";

const tout = new Set<string>(MODULES_AVEC_CODE);

describe("premiers pas par rôle", () => {
  it("3 à 5 actions par rôle, sans doublon", () => {
    for (const role of TOUS_LES_ROLES) {
      const pas = premiersPas(role, role === "chauffeur", tout);
      expect(pas.length, role).toBeGreaterThanOrEqual(PAS_MIN);
      expect(pas.length, role).toBeLessThanOrEqual(PAS_MAX);
      expect(new Set(pas.map((p) => p.href.split(/[?#]/)[0])).size).toBe(pas.length);
    }
  });
  it("jamais un lien vers un écran qui ne s'ouvre pas pour le rôle", () => {
    for (const role of TOUS_LES_ROLES) {
      for (const p of premiersPas(role, role === "chauffeur", tout)) {
        const e = ECRANS.find((x) => x.href === p.href.split(/[?#]/)[0]);
        if (e) expect(ecranOuvrable(e.id, { role, modules: tout, conduit: role === "chauffeur" }), `${role} ${p.href}`).toBe(true);
      }
    }
  });
  it("sans module, pas d'étape de ce module (pas assez d'étapes : bandeau absent plutôt que bancal)", () => {
    const pas = premiersPas("direction", false, new Set());
    for (const p of pas) expect(p.href).not.toMatch(/planning|colis/);
  });
  it("clé de mémorisation par rôle", () => {
    expect(clePremiersPas("manager")).not.toBe(clePremiersPas("direction"));
  });
  it("replié par défaut, affiché seulement à la première visite", () => {
    expect(PREMIERS_PAS_REPLIE_PAR_DEFAUT).toBe(true);
    expect(afficherPremiersPas(null)).toBe(true);
    expect(afficherPremiersPas(undefined)).toBe(true);
    expect(afficherPremiersPas(PREMIERS_PAS_VU)).toBe(false);
    expect(afficherPremiersPas(PREMIERS_PAS_FERME)).toBe(false);
  });
  it("libellé de la ligne repliée", () => {
    expect(libellePremiersPas(4)).toBe("Premiers pas · 4 actions");
    expect(libellePremiersPas(1)).toBe("Premiers pas · 1 action");
  });
});
