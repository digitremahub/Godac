import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { afficherPreparation, type EtapeParcours } from "@/lib/colis/parcours";
import { ECRAN_APRES_GO, ECRAN_REPRISE_GO, MARQUE_HISTORIQUE_GO, ROUTE_GO, ROUTE_TOURNEE, estEntreeGo, retourFermeGo, routeApresSortie } from "@/lib/colis/sortie-go";

const racine = path.resolve(__dirname, "../../..");

describe("sortie de GO Navigation", () => {
  it("la destination est l'écran Ma tournée colis, jamais le tableau de bord", () => {
    expect(ROUTE_TOURNEE).toBe("/livreur");
    expect(ROUTE_GO).toBe("/livreur/navigation");
  });
  it("ouvert par son lien direct, l'adresse redevient celle de la tournée", () => {
    expect(routeApresSortie("/livreur/navigation")).toBe(ROUTE_TOURNEE);
    expect(routeApresSortie("/livreur/navigation/")).toBe(ROUTE_TOURNEE);
  });
  it("déjà sur la tournée, ou ailleurs : l'adresse ne change pas", () => {
    expect(routeApresSortie("/livreur")).toBeNull();
    expect(routeApresSortie("/demo")).toBeNull();
    expect(routeApresSortie("/")).toBeNull();
  });
  it("reconnaît l'entrée d'historique posée par GO", () => {
    expect(estEntreeGo({ [MARQUE_HISTORIQUE_GO]: true })).toBe(true);
    expect(estEntreeGo({ __NA: true })).toBe(false);
    expect(estEntreeGo(null)).toBe(false);
    expect(estEntreeGo("godacGo")).toBe(false);
  });
  it("le retour du navigateur ferme GO quand l'entrée posée a été retirée", () => {
    expect(retourFermeGo(true, true, { __NA: true })).toBe(true);
    expect(retourFermeGo(true, true, null)).toBe(true);
    // Encore sur l'entrée de GO (avance / recul sans effet) ou GO fermé / entrée jamais posée : rien.
    expect(retourFermeGo(true, true, { [MARQUE_HISTORIQUE_GO]: true })).toBe(false);
    expect(retourFermeGo(false, true, null)).toBe(false);
    expect(retourFermeGo(true, false, null)).toBe(false);
  });
  it("l'app chauffeur ferme GO par le même chemin pour tous les boutons (pas de retour vers le tableau de bord)", () => {
    const app = readFileSync(path.join(racine, "components/colis/AppLivreur.tsx"), "utf8");
    expect(app).toContain("useSortieGo(enNavigation");
    expect(app).toContain("onFermer={fermerGo}");
    const go = readFileSync(path.join(racine, "components/colis/GoNavigation.tsx"), "utf8");
    expect(go).not.toMatch(/router\.(push|replace)|history\.back/);
  });
});

describe("écran affiché après GO", () => {
  it("la sortie de GO arrive sur Préparer, à toutes les étapes (tournée démarrée comprise)", () => {
    const etapes: EtapeParcours[] = ["preparer", "demarrer", "livrer", "cloturer", "terminee"];
    for (const e of etapes) expect(afficherPreparation(e, ECRAN_APRES_GO.preparationDemandee)).toBe(true);
    expect(ECRAN_APRES_GO.vue).toBe("liste");
  });
  it("« Reprendre GO » referme la préparation et rouvre la navigation", () => {
    expect(ECRAN_REPRISE_GO).toEqual({ preparationDemandee: false, vue: "navigation" });
    expect(afficherPreparation("livrer", ECRAN_REPRISE_GO.preparationDemandee)).toBe(false);
  });
  it("l'écran de livraison n'a plus d'onglet « Arrêts » ; la préparation propose « Reprendre GO »", () => {
    const app = readFileSync(path.join(racine, "components/colis/AppLivreur.tsx"), "utf8");
    expect(app).not.toContain('"liste", "carte", "navigation"');
    expect(app).not.toMatch(/\? "Arrêts" :/);
    expect(app).toContain("Reprendre GO");
    expect(app).toContain("ECRAN_APRES_GO");
  });
});
