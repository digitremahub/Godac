import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ECRANS, MARQUEUR_GO_NAVIGATION, MODULES_AVEC_CODE, SECTIONS, TOUS_LES_ROLES, menuPour, ongletsSection, sousOnglets } from "@/lib/acces/catalogue";
import { boutonsBarreMobile } from "@/lib/acces/barre-mobile";
import { GLOSSAIRE_TOURNEE, ancienLibelle } from "@/lib/guides/glossaire";
import { GUIDES, GUIDE_GO_NAVIGATION, GUIDE_MANAGER_CONDUCTEUR } from "@/lib/guides/roles";

const RACINE = path.resolve(__dirname, "../../..");
const tout = new Set<string>(MODULES_AVEC_CODE);
const jeux = [tout, new Set(["route_optimizer"]), new Set(["planning"]), new Set(["route_optimizer", MARQUEUR_GO_NAVIGATION])];

describe("glossaire « tournée »", () => {
  it("chaque terme a une définition, un exemple et ses anciens libellés", () => {
    expect(GLOSSAIRE_TOURNEE.map((t) => t.terme)).toEqual(expect.arrayContaining(["Tournée", "Départ / Retour", "Tournée colis", "Modèle de tournée"]));
    for (const t of GLOSSAIRE_TOURNEE) {
      expect(t.definition.length, t.terme).toBeGreaterThan(20);
      expect(t.exemple, t.terme).not.toBe("");
      expect(ancienLibelle(t.exemple), t.terme).toBeNull();
    }
  });

  it("détection sans casse, sans confondre un terme du glossaire avec un ancien libellé", () => {
    expect(ancienLibelle("Démarrer une tournée")).toBe("Démarrer une tournée");
    expect(ancienLibelle("ouvrir la FICHE CHAUFFEUR")).toBe("fiche chauffeur");
    expect(ancienLibelle("Modèles de tournées & villages")).toBeNull();
    expect(ancienLibelle("Tournées & villages")).toBe("Tournées & villages");
  });

  it("aucun ancien libellé dans le catalogue des écrans ni les sections", () => {
    for (const e of ECRANS) for (const l of [e.libelle, e.libelleOnglet, e.libelleSousOnglet]) if (l) expect(ancienLibelle(l), `${e.id} : « ${l} »`).toBeNull();
    for (const s of SECTIONS) expect(ancienLibelle(s.libelle), s.id).toBeNull();
  });

  it("aucun ancien libellé dans le menu, les onglets ni la barre mobile, quel que soit le rôle", () => {
    for (const mods of jeux)
      for (const role of TOUS_LES_ROLES)
        for (const conduit of [false, true]) {
          for (const s of menuPour(role, mods, conduit)) {
            expect(ancienLibelle(s.libelle), `${role} : section ${s.libelle}`).toBeNull();
            for (const e of s.ecrans) expect(ancienLibelle(e.libelleOnglet ?? e.libelle), `${role} : ${e.id}`).toBeNull();
          }
          for (const s of SECTIONS) for (const o of ongletsSection(s.id, role, mods, conduit)) expect(ancienLibelle(o.libelle), `${role} : onglet ${o.id}`).toBeNull();
          for (const p of ["moi.tournee_depart", "exploitation.historique"]) for (const o of sousOnglets(p, role, mods, conduit)) expect(ancienLibelle(o.libelle), `${role} : ${o.id}`).toBeNull();
          for (const enCours of [false, true]) for (const b of boutonsBarreMobile(role, mods, enCours, conduit)) expect(ancienLibelle(b.libelle), `${role} : barre ${b.libelle}`).toBeNull();
        }
  });

  it("aucun ancien libellé dans les guides d'utilisation", () => {
    for (const g of [...GUIDES, GUIDE_GO_NAVIGATION, GUIDE_MANAGER_CONDUCTEUR])
      for (const texte of [g.titre, g.intro, ...g.sections.flatMap((s) => [s.titre, ...s.etapes.flatMap((e) => [e.titre, e.texte, e.lien?.label ?? ""])])])
        expect(ancienLibelle(texte), `${g.titre} : « ${texte.slice(0, 60)}… »`).toBeNull();
  });

  it("aucun ancien libellé dans les titres des écrans de tournée ni l'aide de l'assistant", () => {
    const fichiers = [
      "app/(dashboard)/moi/tournee/depart/page.tsx",
      "app/(dashboard)/moi/tournee/retour/page.tsx",
      "app/(dashboard)/exploitation/tournees/page.tsx",
      "app/(dashboard)/exploitation/colis/page.tsx",
      "components/dashboard/TourHeroCard.tsx",
      "components/colis/AppLivreur.tsx",
      "components/colis/TourneeColis.tsx",
      "components/colis/ChoixRegroupement.tsx",
      "components/planning/PlanningTemplatesPanel.tsx",
      "content/help/tournee.md",
    ];
    for (const f of fichiers) {
      // Textes affichés seulement : les commentaires peuvent citer l'historique.
      const source = readFileSync(path.join(RACINE, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(ancienLibelle(source), f).toBeNull();
    }
  });
});
