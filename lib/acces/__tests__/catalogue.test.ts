import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ECRANS,
  MODULES_AVEC_CODE,
  MODULES_SANS_CODE,
  PAGES_ALIAS,
  TOUS_LES_ROLES,
  deciderAcces,
  ecran,
  entreeActive,
  estModuleVendable,
  menuPour,
  urlDe,
} from "@/lib/acces/catalogue";
import type { UserRole } from "@/lib/types/domain";

const TOUS_MODULES = new Set<string>(MODULES_AVEC_CODE);
const RACINE = path.resolve(__dirname, "../../..");
const DASHBOARD = path.join(RACINE, "app/(dashboard)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return pages(p);
    return n === "page.tsx" ? [p] : [];
  });
}

/** "/vehicles/[id]" pour app/(dashboard)/vehicles/[id]/page.tsx */
const routeDe = (p: string) => "/" + path.relative(DASHBOARD, path.dirname(p)).split(path.sep).join("/");

describe("catalogue des écrans", () => {
  it("identifiants uniques et existants", () => {
    const ids = ECRANS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => ecran("inconnu.x")).toThrow();
  });

  it("chaque écran ne référence que des modules qui existent dans le code", () => {
    for (const e of ECRANS) {
      for (const m of [...(e.modules ?? []), ...(e.modulesAuMoinsUn ?? [])]) expect(TOUS_MODULES.has(m), `${e.id} → ${m}`).toBe(true);
      for (const r of e.rolesMenu ?? []) expect(e.roles, `${e.id} : rolesMenu ⊂ roles`).toContain(r);
    }
  });

  it("chaque page de l'espace connecté appelle garderPage avec l'écran de sa route", () => {
    const toutes = pages(DASHBOARD);
    expect(toutes.length).toBeGreaterThanOrEqual(52);
    for (const p of toutes) {
      const source = readFileSync(p, "utf8");
      const m = source.match(/garderPage\("([\w.]+)"\)/);
      const route = routeDe(p);
      expect(m, `${route} doit appeler garderPage()`).not.toBeNull();
      const e = ecran(m![1]!);
      const attendu = PAGES_ALIAS[route] ?? null;
      if (attendu) expect(e.id).toBe(attendu);
      else expect(e.href.split("?")[0], `${route} garde ${e.id}`).toBe(route);
      // L'ancien mode de refus ne doit plus être utilisé en tête de page.
      expect(source.includes("requireAppUser()"), `${route} : requireAppUser remplacé`).toBe(false);
    }
  });

  it("urlDe remplace les segments dynamiques", () => {
    expect(urlDe("flotte.vehicule_fiche", { id: "abc" })).toBe("/vehicles/abc");
    expect(() => urlDe("flotte.vehicule_fiche")).toThrow();
  });

  it("modules sans code jamais vendables", () => {
    for (const k of MODULES_SANS_CODE) expect(estModuleVendable({ key: k, wave: "v2" })).toBe(false);
    expect(estModuleVendable({ key: "fines", wave: "v2" })).toBe(true);
    expect(estModuleVendable({ key: "fines", wave: "v3" })).toBe(false);
    expect(MODULES_SANS_CODE).toContain("planning_v2");
    expect(MODULES_SANS_CODE).toContain("hr_status_v2");
  });
});

describe("décision d'accès", () => {
  const actifs = new Set(["planning", "fines"]);

  it("refuse par rôle avant le module, avec redirection prévue", () => {
    expect(deciderAcces(ecran("flotte.amendes"), "chauffeur", actifs)).toMatchObject({ ok: false, motif: "role", redirection: "/mes-amendes" });
    expect(deciderAcces(ecran("admin.abonnement"), "manager", actifs)).toMatchObject({ ok: false, motif: "role" });
  });

  it("refuse un module inactif", () => {
    expect(deciderAcces(ecran("carburant.ticpe"), "direction", actifs)).toEqual({ ok: false, motif: "module", modules: ["ticpe_export"] });
    expect(deciderAcces(ecran("moi.amendes"), "chauffeur", new Set())).toMatchObject({ motif: "module" });
  });

  it("au moins un module (OU)", () => {
    expect(deciderAcces(ecran("exploitation.tournees"), "manager", new Set(["route_optimizer"])).ok).toBe(true);
    expect(deciderAcces(ecran("exploitation.tournees"), "manager", new Set())).toMatchObject({ motif: "module" });
  });

  it("ferme les 14 pages ouvertes par URL (incohérences I1-I5)", () => {
    const tout = new Set<string>(MODULES_AVEC_CODE);
    const fermees: [string, UserRole][] = [
      ["equipe.utilisateurs", "chauffeur"],
      ["equipe.utilisateurs", "comptable"],
      ["admin.abonnement", "manager"],
      ["admin.organisation", "chauffeur"],
      ["exploitation.planning", "comptable"],
      ["exploitation.rapports", "chauffeur"],
      ["carburant.ticpe", "manager"],
      ["carburant.ticpe_detail", "chauffeur"],
      ["carburant.revue_ocr", "chauffeur"],
      ["flotte.vehicule_nouveau", "chauffeur"],
      ["flotte.vehicule_nouveau", "comptable"],
      ["carburant.cuves", "chauffeur"],
      ["flotte.vehicules", "chauffeur"],
      ["moi.tournee_depart", "comptable"],
      ["moi.tournee_retour", "direction"],
      ["exploitation.colis", "comptable"],
      ["flotte.entretien", "comptable"],
      ["exploitation.contestations", "comptable"],
    ];
    for (const [id, role] of fermees) expect(deciderAcces(ecran(id), role, tout).ok, `${id} / ${role}`).toBe(false);
  });

  it("décisions client : amendes (Q2), pointage (Q3), calendrier congés (Q4), utilisateurs (Q6), paie (Q1)", () => {
    const tout = new Set<string>(MODULES_AVEC_CODE);
    expect(deciderAcces(ecran("flotte.amendes"), "manager", tout).ok).toBe(true);
    expect(deciderAcces(ecran("flotte.amendes"), "comptable", tout).ok).toBe(true);
    expect(deciderAcces(ecran("equipe.pointage"), "manager", tout).ok).toBe(true);
    expect(deciderAcces(ecran("equipe.conges_calendrier"), "manager_chauffeur", tout).ok).toBe(true);
    expect(deciderAcces(ecran("equipe.utilisateurs"), "manager", tout).ok).toBe(true);
    expect(deciderAcces(ecran("equipe.paie"), "comptable", tout).ok).toBe(true);
    expect(deciderAcces(ecran("equipe.paie_salarie"), "comptable", tout).ok).toBe(true);
    expect(deciderAcces(ecran("equipe.paie"), "manager", tout).ok).toBe(false);
    expect(deciderAcces(ecran("equipe.paie_reglages"), "comptable", tout).ok).toBe(false);
  });
});

describe("menu par rôle", () => {
  const tout = new Set<string>(MODULES_AVEC_CODE);
  const hrefs = (role: UserRole, mods = tout) => menuPour(role, mods).flatMap((s) => s.ecrans.map((e) => e.href));
  const sections = (role: UserRole, mods = tout) => menuPour(role, mods).map((s) => s.id);

  it("aucune URL en double dans le menu, quel que soit le rôle", () => {
    for (const role of TOUS_LES_ROLES) {
      const h = hrefs(role);
      expect(new Set(h).size, role).toBe(h.length);
    }
  });

  it("une seule « Mes amendes » pour le chauffeur, jamais /my-fines", () => {
    const h = hrefs("chauffeur");
    expect(h.filter((x) => x === "/mes-amendes")).toHaveLength(1);
    expect(h).not.toContain("/my-fines");
    expect(h).not.toContain("/fines");
  });

  it("chauffeur : Mon espace, Exploitation (limitée), Carburant, Communication, Aide", () => {
    expect(sections("chauffeur")).toEqual(["dashboard", "moi", "exploitation", "carburant", "communication", "aide"]);
    expect(hrefs("chauffeur")).not.toContain("/planning");
    expect(hrefs("chauffeur")).toContain("/planning/mine");
  });

  it("direction : pas de Mon espace, Administration présente", () => {
    expect(sections("direction")).not.toContain("moi");
    expect(sections("direction")).toContain("admin");
    expect(hrefs("direction")).toContain("/paie");
    expect(hrefs("direction")).not.toContain("/payroll");
    expect(hrefs("direction", new Set(["planning"]))).toContain("/payroll");
  });

  it("comptable : paie, TICPE, congés et pointage personnels, pas d'Administration", () => {
    const h = hrefs("comptable");
    expect(h).toEqual(expect.arrayContaining(["/paie", "/ticpe", "/leaves", "/time-clock", "/payslips", "/fines", "/tours/history"]));
    expect(sections("comptable")).not.toContain("admin");
    expect(h).not.toContain("/planning");
  });

  it("manager : calendrier des congés et pointage d'équipe dans Équipe & RH", () => {
    const eq = menuPour("manager", tout).find((s) => s.id === "equipe")!;
    expect(eq.ecrans.map((e) => e.href)).toEqual(expect.arrayContaining(["/admin/users", "/leaves/planning", "/time-clock", "/leaves"]));
  });

  it("module coupé → entrée retirée, section vide masquée", () => {
    expect(hrefs("chauffeur", new Set())).not.toContain("/mes-amendes");
    expect(sections("comptable", new Set())).not.toContain("equipe");
  });

  it("état actif : la plus longue URL, puis les préfixes aussiActif", () => {
    const e = menuPour("direction", tout).flatMap((s) => s.ecrans);
    expect(entreeActive(e, "/planning")?.id).toBe("exploitation.planning");
    expect(entreeActive(e, "/vehicles/123")?.id).toBe("flotte.vehicules");
    expect(entreeActive(e, "/paie/abc")?.id).toBe("equipe.paie");
    expect(entreeActive(e, "/suivi")?.id).toBe("exploitation.colis");
    const c = menuPour("chauffeur", tout).flatMap((s) => s.ecrans);
    expect(entreeActive(c, "/planning/mine")?.id).toBe("moi.planning");
  });
});
