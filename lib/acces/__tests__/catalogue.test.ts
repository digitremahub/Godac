import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ECRANS,
  MODULES_AVEC_CODE,
  MODULES_SANS_CODE,
  PAGES_ALIAS,
  PREFIXE_SECTION,
  SECTIONS,
  TOUS_LES_ROLES,
  ongletsSection,
  sousOnglets,
  type SectionId,
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
      const route = routeDe(p);
      // URL nue d'une section (/flotte…) : renvoie vers son premier onglet.
      const s = source.match(/redirigerSection\("(\w+)"\)/);
      if (s) {
        expect(PREFIXE_SECTION[s[1] as SectionId], `${route} : section`).toBe(route);
        continue;
      }
      const m = source.match(/garderPage\("([\w.]+)"\)/);
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
    expect(urlDe("flotte.vehicule_fiche", { id: "abc" })).toBe("/flotte/vehicules/abc");
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
    expect(deciderAcces(ecran("flotte.amendes"), "chauffeur", actifs)).toMatchObject({ ok: false, motif: "role", redirection: "/moi/amendes" });
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
    expect(deciderAcces(ecran("equipe.conges_calendrier"), "manager", tout).ok).toBe(true);
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
    expect(h.filter((x) => x === urlDe("moi.amendes"))).toHaveLength(1);
    expect(h).not.toContain("/my-fines");
    expect(h).not.toContain(urlDe("flotte.amendes"));
  });

  it("chauffeur : Mon espace, Exploitation (limitée), Carburant, Communication, Aide", () => {
    expect(sections("chauffeur")).toEqual(["dashboard", "moi", "exploitation", "carburant", "communication", "aide"]);
    expect(hrefs("chauffeur")).not.toContain(urlDe("exploitation.planning"));
    expect(hrefs("chauffeur")).toContain(urlDe("moi.planning"));
  });

  it("direction : pas de Mon espace, Administration présente", () => {
    expect(sections("direction")).not.toContain("moi");
    expect(sections("direction")).toContain("admin");
    expect(hrefs("direction")).toContain(urlDe("equipe.paie"));
    expect(hrefs("direction")).not.toContain(urlDe("equipe.heures"));
    expect(hrefs("direction", new Set(["planning"]))).toContain(urlDe("equipe.heures"));
  });

  it("comptable : paie, TICPE, congés et pointage personnels, pas d'Administration", () => {
    const h = hrefs("comptable");
    expect(h).toEqual(expect.arrayContaining([urlDe("equipe.paie"), urlDe("carburant.ticpe"), urlDe("moi.conges"), urlDe("moi.pointage"), urlDe("moi.fiches_paie"), urlDe("flotte.amendes"), urlDe("exploitation.historique")]));
    expect(sections("comptable")).not.toContain("admin");
    expect(h).not.toContain(urlDe("exploitation.planning"));
  });

  it("manager : calendrier des congés et pointage d'équipe dans Équipe & RH", () => {
    const eq = menuPour("manager", tout).find((s) => s.id === "equipe")!;
    expect(eq.ecrans.map((e) => e.href)).toEqual(expect.arrayContaining([urlDe("equipe.utilisateurs"), urlDe("equipe.pointage"), urlDe("equipe.conges")]));
    // Le calendrier est un sous-onglet des congés.
    expect(sousOnglets("equipe.conges", "manager", tout).map((o) => o.href)).toEqual([urlDe("equipe.conges"), urlDe("equipe.conges_calendrier"), urlDe("equipe.arrets")]);
  });

  it("module coupé → entrée retirée, section vide masquée", () => {
    expect(hrefs("chauffeur", new Set())).not.toContain(urlDe("moi.amendes"));
    // Sans module, Équipe ne garde que les arrêts de travail (obligation légale, aucun module).
    expect(menuPour("comptable", new Set()).find((x) => x.id === "equipe")?.ecrans.map((e) => e.id)).toEqual(["equipe.arrets"]);
    expect(sections("chauffeur", new Set())).not.toContain("equipe");
  });

  it("état actif : la plus longue URL, puis les préfixes aussiActif", () => {
    const e = menuPour("direction", tout).flatMap((s) => s.ecrans);
    expect(entreeActive(e, urlDe("exploitation.planning"))?.id).toBe("exploitation.planning");
    expect(entreeActive(e, "/flotte/vehicules/123")?.id).toBe("flotte.vehicules");
    expect(entreeActive(e, "/equipe/paie/abc")?.id).toBe("equipe.paie");
    expect(entreeActive(e, "/equipe/paie/heures")?.id).toBe("equipe.paie");
    expect(entreeActive(e, "/exploitation/historique/rapports")?.id).toBe("exploitation.historique");
    expect(entreeActive(e, "/carburant/approvisionnements")?.id).toBe("carburant.cuves");
    expect(entreeActive(e, "/exploitation/suivi")?.id).toBe("exploitation.suivi");
    const c = menuPour("chauffeur", tout).flatMap((s) => s.ecrans);
    expect(entreeActive(c, urlDe("moi.planning"))?.id).toBe("moi.planning");
  });
});

describe("manager qui conduit (décision client du 20/10/2026)", () => {
  const tout = new Set<string>(MODULES_AVEC_CODE);

  it("plus aucun rôle manager_chauffeur dans le catalogue", () => {
    expect(TOUS_LES_ROLES).toEqual(["chauffeur", "manager", "exploitation", "comptable", "direction"]);
    for (const e of ECRANS) expect(e.roles as readonly string[], e.id).not.toContain("manager_chauffeur");
  });

  it("les écrans de conduite exigent de conduire", () => {
    expect(deciderAcces(ecran("moi.tournee_depart"), "manager", tout)).toMatchObject({ ok: false, motif: "role", conducteur: true });
    expect(deciderAcces(ecran("moi.tournee_depart"), "manager", tout, true).ok).toBe(true);
    expect(deciderAcces(ecran("moi.tournee_depart"), "chauffeur", tout).ok).toBe(true);
    expect(deciderAcces(ecran("moi.tournee_depart"), "direction", tout, true).ok).toBe(false);
  });

  it("menu du manager qui conduit : Mon espace de conduite en plus de l'encadrement", () => {
    const sans = menuPour("manager", tout).flatMap((s) => s.ecrans.map((e) => e.id));
    const avec = menuPour("manager", tout, true).flatMap((s) => s.ecrans.map((e) => e.id));
    for (const id of ["moi.tournee_depart", "moi.planning", "moi.vehicule", "moi.amendes"]) {
      expect(sans, id).not.toContain(id);
      expect(avec, id).toContain(id);
    }
    expect(avec).toContain("moi.fiches_paie");
    expect(avec).toContain("exploitation.planning");
    expect(avec).toContain("equipe.utilisateurs");
  });
});

describe("onglets de section (lot 4)", () => {
  const tout = new Set<string>(MODULES_AVEC_CODE);

  it("chaque section a un layout avec sa barre d'onglets et une page qui renvoie au premier onglet", () => {
    for (const s of SECTIONS) {
      const dir = path.join(DASHBOARD, PREFIXE_SECTION[s.id]);
      const layout = readFileSync(path.join(dir, "layout.tsx"), "utf8");
      expect(layout, s.id).toContain(`section="${s.id}"`);
      if (s.id !== "dashboard") expect(readFileSync(path.join(dir, "page.tsx"), "utf8"), s.id).toContain(`redirigerSection("${s.id}")`);
    }
  });

  it("chaque écran (hors /v, /account, /partage-go et l'app chauffeur plein écran /livreur) vit sous le préfixe de sa section", () => {
    for (const e of ECRANS) {
      const h = e.href.split("?")[0]!;
      if (h.startsWith("/v/") || h === "/account" || h === "/partage-go" || h === "/livreur" || h.startsWith("/livreur/")) continue;
      const p = PREFIXE_SECTION[e.section];
      expect(h === p || h.startsWith(`${p}/`), `${e.id} → ${h}`).toBe(true);
    }
  });

  it("onglets filtrés par rôle et module, sous-onglets regroupés sous leur parent", () => {
    const hrefs = (o: { href: string }[]) => o.map((x) => x.href);
    expect(hrefs(ongletsSection("carburant", "chauffeur", tout))).toEqual([urlDe("carburant.pleins")]);
    expect(hrefs(ongletsSection("carburant", "direction", tout))).toEqual([
      urlDe("carburant.pleins"),
      urlDe("carburant.revue_ocr"),
      urlDe("carburant.cuves"),
      urlDe("carburant.approvisionnements"),
      urlDe("carburant.ticpe"),
    ]);
    const exploitation = hrefs(ongletsSection("exploitation", "direction", tout));
    expect(exploitation).toContain(urlDe("exploitation.suivi"));
    expect(exploitation).toContain(urlDe("exploitation.historique"));
    expect(exploitation).not.toContain(urlDe("exploitation.rapports"));
    expect(hrefs(sousOnglets("exploitation.historique", "direction", tout))).toEqual([
      urlDe("exploitation.historique"),
      urlDe("exploitation.rapports"),
      urlDe("exploitation.rapports_photos"),
      urlDe("exploitation.historique_colis"),
    ]);
    // Le chauffeur : tournées et tournées colis, pas les rapports.
    expect(hrefs(sousOnglets("exploitation.historique", "chauffeur", tout))).toEqual([urlDe("exploitation.historique"), urlDe("exploitation.historique_colis")]);
    // Sans planning, l'historique colis remonte en onglet de section.
    expect(hrefs(ongletsSection("exploitation", "manager", new Set(["route_optimizer"])))).toContain(urlDe("exploitation.historique_colis"));
    // Sans fiches de paie, Heures & salaires devient un onglet d'Équipe.
    expect(hrefs(ongletsSection("equipe", "direction", new Set(["planning"])))).toContain(urlDe("equipe.heures"));
    expect(hrefs(ongletsSection("equipe", "direction", tout))).not.toContain(urlDe("equipe.heures"));
    expect(hrefs(sousOnglets("equipe.paie", "comptable", tout))).not.toContain(urlDe("equipe.paie_reglages"));
  });

  it("une seule barre d'onglets sur la tournée colis", () => {
    const source = readFileSync(path.join(DASHBOARD, "exploitation/colis/page.tsx"), "utf8");
    expect(source).not.toMatch(/role="tablist"|TourneesTabs/);
  });
});
