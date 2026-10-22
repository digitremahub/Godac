import { describe, expect, it } from "vitest";
import { MARQUEUR_GO_NAVIGATION, MODULES_AVEC_CODE, menuPour, urlDe } from "@/lib/acces/catalogue";
import { ecranOuvrable, ecranTourneesEnCours, tuilesOuvrables, type Tuile } from "@/lib/acces/tuiles-accueil";
import type { UserRole } from "@/lib/types/domain";

const tout = new Set<string>(MODULES_AVEC_CODE);
const sans = (...m: string[]) => new Set([...tout].filter((x) => !m.includes(x)));
const hrefs = (tuiles: readonly Tuile[], role: UserRole, modules: ReadonlySet<string>, conduit?: boolean) => tuilesOuvrables(tuiles, { role, modules, conduit }).map((t) => t.href);
const T = (ecran: string, suite?: string): Tuile => ({ libelle: ecran, valeur: "0", ecran, suite });

describe("tuiles de l'accueil : seulement les écrans qui s'ouvrent", () => {
  it("manager : « Tickets à vérifier » disparaît sans le module OCR", () => {
    expect(hrefs([T("carburant.revue_ocr")], "manager", tout)).toEqual(["/carburant/revue-ocr"]);
    expect(hrefs([T("carburant.revue_ocr")], "manager", sans("ocr"))).toEqual([]);
  });

  it("chaque tuile mène à l'écran prévu, avec sa requête", () => {
    const tuiles = [T("carburant.pleins", "?a_traiter=1"), T("equipe.inscriptions"), T("equipe.conges"), T("flotte.entretien")];
    expect(hrefs(tuiles, "manager", tout)).toEqual(["/carburant/pleins?a_traiter=1", "/equipe/inscriptions", "/equipe/conges", "/flotte/entretien"]);
    expect(hrefs(tuiles, "exploitation", tout)).toEqual(hrefs(tuiles, "manager", tout));
    expect(hrefs(tuiles, "direction", tout)).toEqual(hrefs(tuiles, "manager", tout));
  });

  it("comptable : ni congés à valider (il ne décide pas), ni revue des tickets ; la paie oui", () => {
    expect(hrefs([T("equipe.conges"), T("carburant.revue_ocr"), T("equipe.paie"), T("equipe.paie_export")], "comptable", tout)).toEqual(["/equipe/paie", "/equipe/paie/export"]);
    expect(hrefs([T("carburant.pleins", "?status=awaiting_validation")], "comptable", tout)).toEqual(["/carburant/pleins?status=awaiting_validation"]);
  });

  it("direction : bulletins à valider vers Paie ; exploitation jamais la paie de l'entreprise", () => {
    expect(hrefs([T("equipe.paie")], "direction", tout)).toEqual(["/equipe/paie"]);
    expect(hrefs([T("equipe.paie"), T("equipe.paie_fiches")], "exploitation", tout)).toEqual([]);
    expect(hrefs([T("equipe.paie")], "direction", sans("payslips"))).toEqual([]);
  });

  it("valeurs vides ignorées, ordre conservé", () => {
    expect(tuilesOuvrables([false, null, undefined, "", T("aide.faq"), T("aide.guide")], { role: "chauffeur", modules: tout }).map((t) => t.ecran)).toEqual(["aide.faq", "aide.guide"]);
  });

  it("carte « Démarrer une tournée » : il faut conduire et le module Planning", () => {
    expect(ecranOuvrable("moi.tournee_depart", { role: "chauffeur", modules: tout })).toBe(true);
    expect(ecranOuvrable("moi.tournee_depart", { role: "chauffeur", modules: sans("planning") })).toBe(false);
    expect(ecranOuvrable("moi.tournee_depart", { role: "manager", modules: tout, conduit: true })).toBe(true);
    expect(ecranOuvrable("moi.tournee_depart", { role: "manager", modules: tout, conduit: false })).toBe(false);
  });

  it("compte GO Navigation : aucun écran hors de l'offre", () => {
    const go = new Set(["route_optimizer", MARQUEUR_GO_NAVIGATION]);
    expect(ecranOuvrable("exploitation.colis", { role: "manager", modules: go, conduit: true })).toBe(true);
    expect(ecranOuvrable("carburant.pleins", { role: "manager", modules: go, conduit: true })).toBe(false);
  });
});

describe("tuile « Tournées en cours »", () => {
  it("suivi en direct avec la Tournée colis, sinon le planning, sinon l'historique", () => {
    expect(ecranTourneesEnCours({ role: "manager", modules: tout })).toBe("exploitation.suivi");
    expect(ecranTourneesEnCours({ role: "direction", modules: sans("route_optimizer") })).toBe("exploitation.planning");
    expect(ecranTourneesEnCours({ role: "comptable", modules: tout })).toBe("exploitation.historique");
    expect(ecranTourneesEnCours({ role: "manager", modules: sans("route_optimizer", "planning") })).toBeNull();
    expect(urlDe(ecranTourneesEnCours({ role: "exploitation", modules: tout })!)).toBe("/exploitation/suivi");
  });
});

describe("« Signaler un problème » au menu de toute personne qui conduit", () => {
  const ids = (role: UserRole, conduit?: boolean) => menuPour(role, tout, conduit).flatMap((s) => s.ecrans.map((e) => e.id));
  it("chauffeur, manager et exploitation qui conduisent ; pas l'encadrement qui ne conduit pas", () => {
    expect(ids("chauffeur")).toContain("moi.signaler");
    expect(ids("manager", true)).toContain("moi.signaler");
    expect(ids("exploitation", true)).toContain("moi.signaler");
    expect(ids("manager", false)).not.toContain("moi.signaler");
    expect(ids("direction")).not.toContain("moi.signaler");
  });
});
