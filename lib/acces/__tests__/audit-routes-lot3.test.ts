import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: async () => [] }));

import { regleEffective, refusPour } from "@/lib/acces/garde-api";
import { ENCADREMENT, MODULES_AVEC_CODE, TOUS_LES_ROLES } from "@/lib/acces/catalogue";
import { ROLES_A_TRAITER, TYPES_MANAGER, typeVisiblePour } from "@/lib/a-traiter/logique";
import { peutDecider } from "@/lib/hierarchie/demandes";

/**
 * Matrice rôle × route du lot 3 « planning / RH / paie » : qui obtient quoi,
 * modules actifs. La garde de chaque route est relue dans son source.
 */
const tout = new Set<string>(MODULES_AVEC_CODE);
const autorise = (opts: Parameters<typeof regleEffective>[0], role: (typeof TOUS_LES_ROLES)[number], modules: ReadonlySet<string> = tout) => refusPour(regleEffective(opts), role, modules, role === "chauffeur") === null;
const rolesOk = (opts: Parameters<typeof regleEffective>[0]) => TOUS_LES_ROLES.filter((r) => autorise(opts, r)).sort();
const lire = (f: string) => readFileSync(f, "utf8");

describe("droits par route", () => {
  it("POST /api/time-clock/regulariser : encadrement, module Pointeuse", () => {
    expect(rolesOk({ ecran: "equipe.pointage" })).toEqual(["direction", "exploitation", "manager"]);
    expect(autorise({ ecran: "equipe.pointage" }, "direction", new Set())).toBe(false);
  });
  it("POST /api/paie/lot : direction et comptable, module Paie ; jamais exploitation ni manager", () => {
    expect(rolesOk({ ecran: "equipe.paie_preparer" })).toEqual(["comptable", "direction"]);
    expect(autorise({ ecran: "equipe.paie_preparer" }, "comptable", new Set())).toBe(false);
  });
  it("POST /api/leaves/[id]/liberer : encadrement, modules Congés et Planning", () => {
    const opts = { roles: ENCADREMENT, modules: ["leave_management", "planning"] as const };
    expect(rolesOk(opts)).toEqual(["direction", "exploitation", "manager"]);
    expect(autorise(opts, "manager", new Set(["leave_management"]))).toBe(false);
  });
  it("POST /api/leaves : tout membre (module Congés)", () => {
    expect(rolesOk({ modules: ["leave_management"] })).toEqual(["chauffeur", "comptable", "direction", "exploitation", "manager"]);
  });
});

describe("hiérarchie : personne ne décide sa propre demande", () => {
  it("manager, exploitation : jamais pour eux-mêmes ; direction seule avec trace", () => {
    for (const role of ["manager", "exploitation"]) expect(peutDecider({ decideur: { id: "x", role }, demandeur: { id: "x", role }, directionCount: 1 }).ok, role).toBe(false);
    expect(peutDecider({ decideur: { id: "d", role: "direction" }, demandeur: { id: "d", role: "direction" }, directionCount: 1 })).toEqual({ ok: true, autoValidee: true });
    expect(peutDecider({ decideur: { id: "d", role: "direction" }, demandeur: { id: "d", role: "direction" }, directionCount: 2 }).ok).toBe(false);
  });
  it("un manager régularise un chauffeur, pas un pair", () => {
    expect(peutDecider({ decideur: { id: "m", role: "manager" }, demandeur: { id: "c", role: "chauffeur" }, directionCount: 2 }).ok).toBe(true);
    expect(peutDecider({ decideur: { id: "m", role: "manager" }, demandeur: { id: "m2", role: "manager" }, directionCount: 2 }).ok).toBe(false);
  });
});

describe("« À traiter » : nouveaux types", () => {
  it("pointages, repos, échéances RH : manager (son service), exploitation, direction ; jamais comptable ni chauffeur", () => {
    for (const t of ["pointage_a_regulariser", "repos_conduite", "echeance_rh"] as const) {
      expect(TYPES_MANAGER).toContain(t);
      for (const r of ROLES_A_TRAITER) expect(typeVisiblePour(t, r), `${t} ${r}`).toBe(true);
      for (const r of ["comptable", "chauffeur"]) expect(typeVisiblePour(t, r), `${t} ${r}`).toBe(false);
    }
  });
});

describe("gardes serveur présentes dans les routes", () => {
  it("chaque route nouvelle ou modifiée appelle garderApi avec le bon périmètre", () => {
    const attendu: Record<string, string> = {
      "app/api/time-clock/regulariser/route.ts": 'garderApi({ ecran: "equipe.pointage" })',
      "app/api/paie/lot/route.ts": 'garderApi({ ecran: "equipe.paie_preparer" })',
      "app/api/leaves/[id]/liberer/route.ts": 'garderApi({ roles: ENCADREMENT, modules: ["leave_management", "planning"] })',
      "app/api/leaves/[id]/route.ts": 'garderApi({ modules: ["leave_management"] })',
      "app/api/leaves/route.ts": 'garderApi({ modules: ["leave_management"] })',
      "app/api/paie/bulletins/route.ts": "garderApi({ roles: ROLES_GENERATION",
      "app/api/time-clock/route.ts": 'garderApi({ modules: ["time_clock"] })',
    };
    for (const [f, garde] of Object.entries(attendu)) expect(lire(f), f).toContain(garde);
  });
  it("régularisation : hiérarchie, motif, organisation et trace d'audit", () => {
    const src = lire("app/api/time-clock/regulariser/route.ts");
    expect(src).toContain("garderDecision(");
    expect(src).toContain("validerCorrection(");
    expect(src).toContain('.eq("organization_id", appUser.organization_id)');
    expect(src).toContain('action: "pointage_regularise"');
    expect(src).toContain('action: "pointage_ajoute"');
    expect(src).toContain("avant:");
  });
  it("congés : décision gardée par la hiérarchie, solde contrôlé côté serveur, décision tracée", () => {
    const src = lire("app/api/leaves/[id]/route.ts");
    expect(src.indexOf("garderDecision(")).toBeGreaterThan(-1);
    expect(src).toContain("controlerApprobation(");
    expect(src).toContain('action: "conge_decision"');
    expect(lire("app/api/leaves/route.ts")).toContain("controlerDemande(");
  });
  it("la paie en lot ne valide jamais : la validation reste à la direction", () => {
    expect(lire("lib/paie/lot-serveur.ts")).toContain("validerSiDirection: false");
    expect(lire("app/api/paie/bulletins/route.ts")).toContain("validerSiDirection: true");
  });
  it("audit étendu : planning, profil de paie, contrat, invitations, organisation", () => {
    const attendu: Record<string, string> = {
      "app/api/planning/affecter/route.ts": 'action: "planning_affectation"',
      "app/api/planning/entries/[id]/route.ts": 'action: "planning_tournee_retiree"',
      "app/api/paie/profils/[userId]/route.ts": 'action: "paie_profil_modifie"',
      "app/api/admin/users/[id]/route.ts": 'action: "contrat_modifie"',
      "app/api/admin/invite/route.ts": 'action: "utilisateur_invite"',
      "app/api/admin/organization/route.ts": 'action: "organisation_modifiee"',
    };
    for (const [f, a] of Object.entries(attendu)) expect(lire(f), f).toContain(a);
  });
  it("le cron RH exige CRON_SECRET et borne par organisation", () => {
    const cron = lire("app/api/cron/rh-quotidien/route.ts");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toContain("unauthorized");
    expect((lire("lib/alerts/echeances-rh-serveur.ts").match(/\.eq\("organization_id", organizationId\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((lire("lib/time-clock/regularisation-serveur.ts").match(/\.eq\("organization_id", organizationId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("le webhook Stripe traite l'impayé sans bloquer l'accès", () => {
    const src = lire("app/api/webhooks/stripe/route.ts");
    expect(src).toContain('case "invoice.payment_failed"');
    expect(src).not.toContain("subscription_status: \"canceled\"");
  });
});

describe("vercel.json : aucun cron plus fréquent qu'une fois par jour", () => {
  const crons = JSON.parse(lire("vercel.json")).crons as { path: string; schedule: string }[];
  it("le cron RH est quotidien (minute et heure fixes)", () => {
    const c = crons.find((x) => x.path === "/api/cron/rh-quotidien");
    expect(c?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});

describe("migrations additives, rejouables, enum séparé", () => {
  it("les valeurs d'enum sont dans un fichier distinct de celui qui les utilise", () => {
    const enumSql = lire("supabase/migrations/20261110000001_alertes_rh_types.sql");
    const suite = lire("supabase/migrations/20261110000002_planning_rh_paie_lot3.sql");
    for (const v of ["echeance_rh", "pointage_a_regulariser", "paiement_echoue"]) expect(enumSql).toContain(`add value if not exists '${v}'`);
    expect(suite).not.toMatch(/add value/);
    expect(suite).toContain("add column if not exists needs_regularization");
    expect(suite).toContain("add column if not exists expires_at");
    for (const f of [enumSql, suite]) expect(/drop (table|column)|delete from|truncate/i.test(f), "pas destructif").toBe(false);
  });
});
