import { describe, expect, it } from "vitest";
import { ECRANS, MODULES_AVEC_CODE, TOUS_LES_ROLES } from "@/lib/acces/catalogue";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import { MAX_PAR_CATEGORIE, categoriesEntites, chercherPages, motifIlike, normaliser, pagesAutorisees, peutChercherEntites } from "@/lib/recherche/recherche";

const tout = new Set<string>(MODULES_AVEC_CODE);
const ctx = (role: (typeof TOUS_LES_ROLES)[number], modules: ReadonlySet<string> = tout, conduit = role === "chauffeur") => ({ role, modules, conduit });

describe("recherche de pages : jamais une page non autorisée", () => {
  it("pour chaque rôle, toute page proposée s'ouvre pour lui", () => {
    for (const role of TOUS_LES_ROLES) {
      for (const p of pagesAutorisees(ctx(role))) expect(ecranOuvrable(p.id, ctx(role)), `${role} ${p.id}`).toBe(true);
      for (const p of chercherPages(ctx(role), "e")) expect(ecranOuvrable(p.id, ctx(role)), `${role} ${p.id}`).toBe(true);
    }
  });
  it("la paie n'est proposée qu'à la direction et au comptable", () => {
    for (const role of ["chauffeur", "manager", "exploitation"] as const) expect(chercherPages(ctx(role), "paie").map((p) => p.id), role).not.toContain("equipe.paie");
    for (const role of ["direction", "comptable"] as const) expect(chercherPages(ctx(role), "paie").map((p) => p.id), role).toContain("equipe.paie");
  });
  it("le suivi, les tournées en cours et la clôture : encadrement seulement", () => {
    for (const role of ["chauffeur", "comptable"] as const) {
      const ids = chercherPages(ctx(role), "").map((p) => p.id).concat(chercherPages(ctx(role), "suivi").map((p) => p.id), chercherPages(ctx(role), "cloture").map((p) => p.id));
      expect(ids).not.toContain("exploitation.suivi");
      expect(ids).not.toContain("exploitation.cloture");
      expect(ids).not.toContain("exploitation.en_cours");
    }
    expect(chercherPages(ctx("manager"), "cloture").map((p) => p.id)).toContain("exploitation.cloture");
  });
  it("un module absent retire la page", () => {
    expect(chercherPages(ctx("direction", new Set()), "planning").map((p) => p.id)).not.toContain("exploitation.planning");
  });
  it("insensible aux accents et à la casse, résultats bornés", () => {
    expect(chercherPages(ctx("direction"), "TOURNEES EN COURS").map((p) => p.id)).toContain("exploitation.en_cours");
    expect(chercherPages(ctx("direction"), "").length).toBeLessThanOrEqual(MAX_PAR_CATEGORIE);
    expect(normaliser("Clôture de la journée")).toBe("cloture de la journee");
  });
  it("pas de page à identifiant (fiches) dans les suggestions", () => {
    for (const p of pagesAutorisees(ctx("direction"))) expect(p.href).not.toMatch(/\[/);
    expect(ECRANS.some((e) => /\[/.test(e.href))).toBe(true);
  });
});

describe("recherche d'entités par rôle", () => {
  it("chauffeur et comptable : pages seulement", () => {
    for (const r of ["chauffeur", "comptable"] as const) {
      expect(peutChercherEntites(r)).toBe(false);
      expect(categoriesEntites(ctx(r))).toEqual([]);
    }
  });
  it("manager, exploitation, direction : chauffeurs, véhicules, tournées", () => {
    for (const r of ["manager", "exploitation", "direction"] as const) expect(categoriesEntites(ctx(r)).sort()).toEqual(["chauffeurs", "tournees", "vehicules"]);
  });
  it("sans le module Planning, plus de recherche de tournées", () => {
    expect(categoriesEntites(ctx("direction", new Set(["fleet"]))) ).not.toContain("tournees");
  });
  it("motif sûr pour PostgREST : 2 caractères au moins, aucun caractère de filtre", () => {
    expect(motifIlike("a")).toBeNull();
    expect(motifIlike("aa-123")).toBe("%aa%123%");
    expect(motifIlike("x,or(id.eq.1)")).toBe("%x%or%id%eq%1%");
    expect(motifIlike("100% *")).toBe("%100%");
  });
});
