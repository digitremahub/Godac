import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const racine = path.resolve(__dirname, "../../..");
const lire = (f: string) => readFileSync(path.join(racine, f), "utf8");
const fenetre = lire("components/colis/FenetreArret.tsx");
const go = lire("components/colis/GoNavigation.tsx");
const app = lire("components/colis/AppLivreur.tsx");

describe("fenêtre d'arrêt unique", () => {
  it("GoNavigation et AppLivreur utilisent le même composant FenetreArret", () => {
    for (const src of [go, app]) {
      expect(src).toContain('from "@/components/colis/FenetreArret"');
      expect(src).toMatch(/<FenetreArret[\s\n]/);
    }
  });
  it("une seule fenêtre : l'ancien menu et l'ancienne fiche sont supprimés", () => {
    expect(go).not.toContain("MenuRapideArret");
    expect(go).not.toContain("onFiche");
    expect(app).not.toContain("onFiche=");
    expect(app).not.toContain("fiche-arret-title");
    expect(app).not.toContain("Fiche de livraison");
    expect(`${go}${app}${fenetre}`).not.toMatch(/Fiche de l(&apos;|')arrêt/);
  });
  it("GO ouvre la fenêtre depuis ⋯ Plus, l'appui long, la carte et ✏️", () => {
    expect(go.match(/setMenuArret\(/g)!.length).toBeGreaterThanOrEqual(5);
    expect(go).toContain("attacherAppuiLong(el, () => setMenuArret(s))");
  });
  it("la liste de l'app chauffeur ouvre la même fenêtre", () => {
    expect(app).toContain("setDetailsStop(s)");
    expect(app).toMatch(/<FenetreArret[\s\S]*onFermer=\{\(\) => setDetailsStop\(null\)\}/);
  });
  it("toutes les actions sont présentes", () => {
    for (const t of ["Non livré", "Appeler", "Ajouter le numéro", "Waze", "Google Maps", "Horaires", "Modifier l&apos;adresse", "Modifier la fiche", "Passer à plus tard", "Retirer cette adresse", "SMS", "Historique", "CasesContact", "libelleLivre"]) {
      expect(fenetre).toContain(t);
    }
  });
  it("ordre : identité, actions principales, infos, actions secondaires", () => {
    const pos = ["{/* 1. Identité", "{/* 2. Actions principales", "{/* 3. Infos", "{/* 4. Actions secondaires"].map((m) => fenetre.indexOf(m));
    expect(pos.every((i) => i >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
  it("feuille basse mobile : safe-area, 85dvh défilable, cibles 48 px", () => {
    expect(fenetre).toContain("max-h-[85dvh]");
    expect(fenetre).toContain("overflow-y-auto");
    expect(fenetre).toContain("env(safe-area-inset-bottom)");
    expect(fenetre).toContain("min-h-[48px]");
    expect(fenetre).toContain("btn-primary");
    expect(fenetre).toContain("btn-secondary");
  });
  it("lecture seule : les actions d'écriture sont conditionnées par !lecture", () => {
    expect((fenetre.match(/!lecture/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("la modification de la fiche reste dans la même fenêtre (pas de seconde fenêtre)", () => {
    expect(fenetre).toContain("<FicheEdition");
    expect((fenetre.match(/role="dialog"/g) ?? []).length).toBe(1);
  });
});
