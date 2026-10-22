import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { actionPrincipale, afficherPreparation, etapeParcours, etatsEtapes, ETAPES_PARCOURS } from "@/lib/colis/parcours";
import { boutonsBarreMobile } from "@/lib/acces/barre-mobile";
import { MARQUEUR_GO_NAVIGATION, urlDe } from "@/lib/acces/catalogue";

describe("parcours « Ma tournée colis » : étape courante selon la tournée colis", () => {
  it("aucune tournée colis, ou en préparation sans arrêt → Préparer", () => {
    expect(etapeParcours({ statut: null, arrets: 0, restants: 0 })).toBe("preparer");
    expect(etapeParcours({ statut: "loading", arrets: 0, restants: 0 })).toBe("preparer");
  });

  it("en préparation avec des arrêts → Démarrer", () => {
    expect(etapeParcours({ statut: "loading", arrets: 12, restants: 12 })).toBe("demarrer");
  });

  it("démarrée : Livrer tant qu'il reste des arrêts, puis Clôturer", () => {
    expect(etapeParcours({ statut: "in_progress", arrets: 12, restants: 3 })).toBe("livrer");
    expect(etapeParcours({ statut: "in_progress", arrets: 12, restants: 0 })).toBe("cloturer");
  });

  it("clôturée → Terminée (verrouillée), même avec des arrêts en échec", () => {
    expect(etapeParcours({ statut: "done", arrets: 12, restants: 0 })).toBe("terminee");
    expect(etapeParcours({ statut: "done", arrets: 12, restants: 2 })).toBe("terminee");
  });

  it("quatre étapes dans l'ordre, l'étape courante seule « en cours »", () => {
    expect(ETAPES_PARCOURS.map((e) => e.libelle)).toEqual(["Préparer", "Démarrer", "Livrer", "Clôturer"]);
    expect(etatsEtapes("livrer").map((e) => e.etat)).toEqual(["faite", "faite", "en_cours", "a_venir"]);
    expect(etatsEtapes("preparer").map((e) => e.etat)).toEqual(["en_cours", "a_venir", "a_venir", "a_venir"]);
    expect(etatsEtapes("terminee").every((e) => e.etat === "faite")).toBe(true);
  });

  it("la préparation (scan, bordereau, adresse) s'affiche avant le départ, après la clôture, ou à la demande en livraison", () => {
    expect(afficherPreparation("preparer", false)).toBe(true);
    expect(afficherPreparation("demarrer", false)).toBe(true);
    expect(afficherPreparation("terminee", false)).toBe(true);
    expect(afficherPreparation("livrer", false)).toBe(false);
    expect(afficherPreparation("cloturer", false)).toBe(false);
    expect(afficherPreparation("livrer", true)).toBe(true);
  });

  it("une action principale par étape", () => {
    expect(actionPrincipale("demarrer")).toBe("Vérifier la tournée et démarrer");
    expect(actionPrincipale("terminee")).toBe("Nouvelle tournée colis");
  });
});

describe("un seul point d'entrée colis pour le conducteur", () => {
  const tout = new Set(["planning", "route_optimizer", "messenger"]);

  it("la barre mobile ouvre « Ma tournée colis », comme le menu", () => {
    expect(boutonsBarreMobile("chauffeur", tout, false).find((b) => b.icone === "colis")?.href).toBe(urlDe("moi.tournee_colis"));
    expect(boutonsBarreMobile("manager", tout, false, true).find((b) => b.icone === "colis")?.href).toBe(urlDe("moi.tournee_colis"));
    const go = new Set(["route_optimizer", MARQUEUR_GO_NAVIGATION]);
    expect(boutonsBarreMobile("manager", go, false, true)[0]).toMatchObject({ href: urlDe("moi.tournee_colis"), libelle: "Tournée colis" });
  });

  it("l'application chauffeur intègre la préparation et ne renvoie plus vers l'écran de l'encadrement", () => {
    const racine = path.resolve(__dirname, "../../..");
    const app = readFileSync(path.join(racine, "components/colis/AppLivreur.tsx"), "utf8");
    expect(app).toContain("<TourneeColis");
    expect(app).not.toContain('href="/exploitation/colis"');
    const page = readFileSync(path.join(racine, "app/livreur/page.tsx"), "utf8");
    expect(page).toContain('garderPage("moi.tournee_colis")');
  });
});
