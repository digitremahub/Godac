import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Accueil mobile : le titre « Bonjour … » vient d'abord, puis le bloc « À traiter »,
 * puis la suite (raccourcis, Premiers pas). Contrôle de l'ordre des blocs dans les sources.
 */
const RACINE = path.resolve(__dirname, "../../..");
const lire = (f: string) => readFileSync(path.join(RACINE, f), "utf8");
const ACCUEILS = ["Direction", "Manager", "ChefEquipe", "Comptable", "Chauffeur"] as const;

describe("ordre des blocs de l'accueil", () => {
  it.each(ACCUEILS)("%s : titre, puis la suite des raccourcis", (nom) => {
    const s = lire(`components/dashboard/${nom}Dashboard.tsx`);
    const titre = s.indexOf("<PageHeader");
    const suite = s.indexOf("{suite}");
    expect(titre).toBeGreaterThan(-1);
    expect(suite).toBeGreaterThan(titre);
  });
  it.each(["Direction", "Manager"] as const)("%s : « À traiter » avant les raccourcis", (nom) => {
    const s = lire(`components/dashboard/${nom}Dashboard.tsx`);
    expect(s.indexOf("<ATraiterBloc")).toBeGreaterThan(s.indexOf("<PageHeader"));
    expect(s.indexOf("{suite}")).toBeGreaterThan(s.indexOf("<ATraiterBloc"));
  });
  it("la page ne place plus rien avant l'accueil du rôle", () => {
    const s = lire("app/(dashboard)/dashboard/page.tsx");
    expect(s).toContain("return accueil;");
    expect(s).not.toMatch(/\{entete\}/);
  });
  it("messagerie flottante au-dessus de la barre du bas, 48 px, contenu avec marge basse", () => {
    const w = lire("components/chat/FloatingChatWidget.tsx");
    expect(w).toMatch(/bottom-\[calc\(5\.5rem\+env\(safe-area-inset-bottom\)\)\][^"]*h-12 w-12/);
    expect(lire("components/layout/DashboardShell.tsx")).toContain("pb-[calc(9rem+env(safe-area-inset-bottom))]");
  });
});
