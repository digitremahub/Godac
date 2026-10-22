import { describe, expect, it } from "vitest";
import { MARQUEUR_GO_NAVIGATION, MODULES_AVEC_CODE, deciderAcces, ecran, entreeActive, menuAffiche, ongletsMonEspace, urlDe } from "@/lib/acces/catalogue";
import type { UserRole } from "@/lib/types/domain";

const tout = new Set<string>(MODULES_AVEC_CODE);
const groupes = (role: UserRole, conduit?: boolean, mods: ReadonlySet<string> = tout) => ongletsMonEspace(role, mods, conduit);
const ids = (role: UserRole, conduit?: boolean, mods: ReadonlySet<string> = tout) =>
  Object.fromEntries(groupes(role, conduit, mods).map((g) => [g.id, g.onglets.map((o) => o.id)]));

describe("Mon espace en 3 onglets", () => {
  it("chauffeur : Ma journée, Mes documents, Mes demandes", () => {
    expect(groupes("chauffeur").map((g) => g.libelle)).toEqual(["Ma journée", "Mes documents", "Mes demandes"]);
    expect(ids("chauffeur")).toEqual({
      journee: ["moi.tournee_depart", "moi.tournee_colis", "moi.planning", "moi.pointage", "carburant.pleins", "moi.vehicule", "moi.signaler"],
      documents: ["moi.fiches_paie", "moi.amendes", "exploitation.contestations"],
      demandes: ["moi.conges", "moi.acomptes"],
    });
  });

  it("les URL actuelles restent celles des onglets (aucune nouvelle page, aucun écran perdu)", () => {
    const g = groupes("chauffeur");
    const hrefs = g.flatMap((x) => x.onglets.map((o) => o.href));
    expect(hrefs).toEqual(
      expect.arrayContaining(["/moi/tournee/depart", "/livreur", "/moi/planning", "/moi/pointage", "/carburant/pleins?new=1", "/moi/vehicule", "/moi/signaler", "/moi/fiches-de-paie", "/moi/amendes", "/exploitation/contestations", "/moi/conges", "/moi/acomptes"]),
    );
    // Lien de l'onglet : premier écran sous /moi.
    expect(g.map((x) => x.href)).toEqual(["/moi/tournee/depart", "/moi/fiches-de-paie", "/moi/conges"]);
    // Le retour et la saisie pour un collègue allument « Ma journée » (sous-onglets de Départ / Retour).
    expect(g[0]!.prefixes).toEqual(expect.arrayContaining(["/moi/tournee/retour", "/moi/tournee/collegue"]));
  });

  it("manager qui ne conduit pas : ni écrans de conduite ni « Pour un collègue » en tête (il passe par le Planning)", () => {
    expect(ids("manager", false)).toEqual({ journee: ["moi.pointage"], documents: ["moi.fiches_paie"], demandes: ["moi.conges", "moi.acomptes"] });
    // L'écran reste ouvert (droits inchangés).
    expect(deciderAcces(ecran("moi.tournee_collegue"), "manager", tout, false).ok).toBe(true);
  });

  it("manager ou exploitation qui conduit : écrans de conduite, mais pas les contestations (il les traite dans Exploitation)", () => {
    for (const role of ["manager", "exploitation"] as const) {
      const g = ids(role, true);
      expect(g.journee).toEqual(["moi.tournee_depart", "moi.tournee_colis", "moi.planning", "moi.pointage", "carburant.pleins", "moi.vehicule", "moi.signaler"]);
      expect(g.documents).toEqual(["moi.fiches_paie", "moi.amendes"]);
    }
  });

  it("comptable : pas de conduite ; direction : pas de Mon espace", () => {
    expect(ids("comptable")).toEqual({ journee: ["moi.pointage"], documents: ["moi.fiches_paie"], demandes: ["moi.conges", "moi.acomptes"] });
    expect(groupes("direction")).toEqual([]);
  });

  it("modules coupés : un onglet vide disparaît, le plein reste", () => {
    expect(ids("chauffeur", true, new Set())).toEqual({ journee: ["carburant.pleins", "moi.vehicule"] });
    expect(groupes("comptable", false, new Set())).toEqual([]);
  });

  it("compte GO Navigation : seulement sa tournée colis", () => {
    expect(ids("manager", true, new Set(["route_optimizer", MARQUEUR_GO_NAVIGATION]))).toEqual({ journee: ["moi.tournee_colis"] });
  });
});

describe("menu affiché : Mon espace réduit à ses onglets", () => {
  it("trois entrées Mon espace au lieu de neuf, aucune URL en double", () => {
    const m = menuAffiche("chauffeur", tout);
    const moi = m.find((s) => s.id === "moi")!;
    expect(moi.ecrans.map((e) => e.libelle)).toEqual(["Ma journée", "Mes documents", "Mes demandes"]);
    for (const role of ["chauffeur", "manager", "exploitation", "comptable", "direction"] as const)
      for (const conduit of [false, true]) {
        const h = menuAffiche(role, tout, conduit).flatMap((s) => s.ecrans.map((e) => e.href));
        expect(new Set(h).size, role).toBe(h.length);
      }
  });

  it("l'entrée allumée suit l'écran ouvert", () => {
    const e = menuAffiche("chauffeur", tout).flatMap((s) => s.ecrans);
    expect(entreeActive(e, "/moi/acomptes")?.id).toBe("moi.groupe.demandes");
    expect(entreeActive(e, "/moi/amendes")?.id).toBe("moi.groupe.documents");
    expect(entreeActive(e, "/moi/tournee/retour")?.id).toBe("moi.groupe.journee");
    expect(entreeActive(e, urlDe("carburant.pleins"))?.id).toBe("carburant.pleins");
  });

  it("chauffeur : « Mes tournées » au lieu d'Exploitation, sans les contestations (déjà dans Mes documents)", () => {
    const m = menuAffiche("chauffeur", tout);
    const t = m.find((s) => s.id === "exploitation")!;
    expect(t.libelle).toBe("Mes tournées");
    expect(t.ecrans.map((e) => e.id)).not.toContain("exploitation.contestations");
    expect(menuAffiche("manager", tout).find((s) => s.id === "exploitation")!.libelle).toBe("Exploitation");
  });
});
